import { createHash } from "node:crypto";

/**
 * Meta Conversions API "Lead" for a completed booking (brief §9). Sent from the
 * server after the response, only with ad consent and when META_PIXEL_ID +
 * META_CAPI_TOKEN are set. The phone is SHA-256 hashed (digits with country
 * code, as Meta requires); event_id = booking ref de-duplicates with the Pixel.
 */
export type LeadInput = { ref: string; phoneE164: string; ip: string; userAgent: string | null; cookies: string | null; url: string };

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const cookie = (all: string | null, name: string) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(all ?? "")?.[1];

export function leadPayload(input: LeadInput, nowSec = Math.floor(Date.now() / 1000)) {
  const user_data: Record<string, unknown> = { ph: [sha256(input.phoneE164.replace(/\D/g, ""))], country: [sha256("in")] };
  if (input.ip && input.ip !== "unknown") user_data.client_ip_address = input.ip;
  if (input.userAgent) user_data.client_user_agent = input.userAgent;
  const fbp = cookie(input.cookies, "_fbp");
  const fbc = cookie(input.cookies, "_fbc");
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  return {
    data: [
      {
        event_name: "Lead",
        event_time: nowSec,
        event_id: input.ref,
        action_source: "website",
        event_source_url: input.url,
        user_data,
        custom_data: { content_name: "Table booking" },
      },
    ],
  };
}

export async function sendLead(input: LeadInput, fetchImpl: typeof fetch = fetch): Promise<"sent" | "skipped" | "failed"> {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return "skipped";
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v23.0/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(leadPayload(input)),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
