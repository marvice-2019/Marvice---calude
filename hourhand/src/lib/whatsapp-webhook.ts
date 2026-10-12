import type pg from "pg";
import { isStop, parseWebhook, sendWhatsApp, STOP_REPLY, textMessage, verifyWebhookSignature, type WhatsAppConfig } from "./whatsapp-cloud";

type Result = { status: number; body: string | Record<string, unknown> };

/** Meta's one-time check when the webhook is set up: echo the challenge if the verify token matches. */
export function verifyWhatsAppSubscription(cfg: WhatsAppConfig | null, params: URLSearchParams): Result {
  if (!cfg) return { status: 503, body: { error: "not_configured" } };
  if (params.get("hub.mode") !== "subscribe" || params.get("hub.verify_token") !== cfg.verifyToken) return { status: 403, body: { error: "forbidden" } };
  return { status: 200, body: params.get("hub.challenge") ?? "" };
}

/**
 * A signed webhook POST: a failed delivery marks its row failed; a STOP reply opts that number out for every host,
 * drops its queued messages and gets one free confirmation reply. Answers 200 once handled (Meta retries anything else).
 */
export async function handleWhatsAppWebhook(
  pool: pg.Pool, cfg: WhatsAppConfig | null, raw: string, signature: string | null, fetchFn: typeof fetch = fetch,
): Promise<Result> {
  if (!cfg) return { status: 503, body: { error: "not_configured" } };
  if (!verifyWebhookSignature(cfg.appSecret, raw, signature)) return { status: 401, body: { error: "bad_signature" } };
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "bad_body" } };
  }
  const { statuses, messages } = parseWebhook(payload);
  for (const s of statuses) {
    if (s.status !== "failed") continue; // sent, delivered and read change nothing: the row is already "sent"
    await pool.query(
      "update notifications set status = 'failed', last_error = $2, updated_at = now() where channel = 'whatsapp' and provider_message_id = $1",
      [s.id, s.error]);
  }
  for (const m of messages) {
    if (!isStop(m.text)) continue;
    const { rowCount } = await pool.query("insert into whatsapp_opt_outs (phone) values ($1) on conflict (phone) do nothing", [m.from]);
    await pool.query(
      "update notifications set status = 'skipped', last_error = 'guest replied STOP on WhatsApp', updated_at = now() where channel = 'whatsapp' and recipient = $1 and status = 'queued'",
      [m.from]);
    // Confirm once; a repeated STOP gets no second reply. A failed reply is not worth Meta retrying the whole webhook.
    if (rowCount) {
      await sendWhatsApp(cfg, textMessage(m.from, STOP_REPLY), fetchFn).catch((error: Error) => console.warn(`[whatsapp] STOP reply failed: ${error.message}`));
    }
  }
  return { status: 200, body: { ok: true } };
}
