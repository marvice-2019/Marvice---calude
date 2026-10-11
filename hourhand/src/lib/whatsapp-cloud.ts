import { createHmac, timingSafeEqual } from "node:crypto";
import { formatDate, formatTime, zoneName } from "./format";

// Automatic WhatsApp (D7): approved utility templates sent from Hourhand's own number through Meta's Cloud API. One
// number serves every host; the host's name is a template variable. Templates exist in English and Hindi; a guest who
// booked in another language gets English until those templates are approved.

export const GRAPH_VERSION = "v23.0";

export interface WhatsAppConfig { phoneNumberId: string; accessToken: string; appSecret: string; verifyToken: string; baseUrl: string }

type Env = Record<string, string | undefined>;

/** Null when WhatsApp isn't set up on this server: nothing is queued and nothing is sent. */
export function whatsappConfig(env: Env = process.env): WhatsAppConfig | null {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID, accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const appSecret = env.WHATSAPP_APP_SECRET, verifyToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!phoneNumberId || !accessToken || !appSecret || !verifyToken) return null;
  // The e2e run points this at a fake server; a real deployment always talks to Meta.
  const fake = env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1" ? env.WHATSAPP_API_BASE_URL : undefined;
  return { phoneNumberId, accessToken, appSecret, verifyToken, baseUrl: fake || "https://graph.facebook.com" };
}

/** Booking news a guest can get on WhatsApp. Host emails, extra guests and everything else stay email-only. */
export type WhatsAppKind = "booked_guest" | "reminder_guest" | "cancelled_guest" | "rescheduled_guest";
export const WHATSAPP_KINDS: readonly WhatsAppKind[] = ["booked_guest", "reminder_guest", "cancelled_guest", "rescheduled_guest"];
export const isWhatsAppKind = (kind: string): kind is WhatsAppKind => (WHATSAPP_KINDS as readonly string[]).includes(kind);

/** WhatsApp messages a host's guests can get per calendar month (IST). Over it, email still goes. */
export const WHATSAPP_MONTHLY_LIMITS = { free: 0, solo: 300, duo: 600 } as const;

type TemplateLang = "en" | "hi";

/** The approved templates, by name. Bodies take {{1}} first name, {{2}} event, {{3}} host, {{4}} when (or what changed); the button opens /b/{{1}}. */
export const TEMPLATES = {
  hh_booking_confirmed: {
    en: { body: "Hi {{1}}, your {{2}} with {{3}} is booked for {{4}}. Use the button below to reschedule or cancel.", button: "Manage booking" },
    hi: { body: "नमस्ते {{1}}, {{3}} के साथ आपका {{2}} {{4}} के लिए बुक हो गया है। समय बदलने या रद्द करने के लिए नीचे का बटन दबाएँ।", button: "बुकिंग देखें" },
  },
  hh_booking_reminder: {
    en: { body: "Hi {{1}}, a reminder: your {{2}} with {{3}} is on {{4}}. Use the button below to reschedule or cancel.", button: "Manage booking" },
    hi: { body: "नमस्ते {{1}}, याद दिला दें: {{3}} के साथ आपका {{2}} {{4}} को है। समय बदलने या रद्द करने के लिए नीचे का बटन दबाएँ।", button: "बुकिंग देखें" },
  },
  hh_booking_changed: {
    en: { body: "Hi {{1}}, your {{2}} with {{3}} has changed: {{4}}. Use the button below for details.", button: "View booking" },
    hi: { body: "नमस्ते {{1}}, {{3}} के साथ आपके {{2}} में बदलाव हुआ है: {{4}}। जानकारी के लिए नीचे का बटन दबाएँ।", button: "बुकिंग देखें" },
  },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

const TEMPLATE_FOR: Record<WhatsAppKind, TemplateName> = {
  booked_guest: "hh_booking_confirmed", reminder_guest: "hh_booking_reminder", cancelled_guest: "hh_booking_changed", rescheduled_guest: "hh_booking_changed",
};

/** What changed, as {{4}} of hh_booking_changed. */
const CHANGE: Record<TemplateLang, { cancelled: string; moved: (when: string) => string }> = {
  en: { cancelled: "it has been cancelled", moved: (when) => `it is now on ${when}` },
  hi: { cancelled: "यह रद्द हो गया है", moved: (when) => `अब यह ${when} को है` },
};

export interface WhatsAppBookingContext {
  guestName: string;
  hostName: string;
  eventName: string;
  startAt: Date;
  guestTimezone: string;
  locale: string;
  /** The booking's manage token: the template's button opens /b/<token>. */
  manageToken: string;
}

/** WhatsApp refuses template variables with line breaks, tabs or long runs of spaces; names are also kept short. */
function param(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || "-";
}

/** The Cloud API request body for one booking message to `to` (digits with country code). */
export function templateMessage(kind: WhatsAppKind, c: WhatsAppBookingContext, to: string) {
  const lang: TemplateLang = c.locale === "hi" ? "hi" : "en";
  const first = c.guestName.trim().split(/\s+/)[0] || c.guestName;
  const when = `${formatDate(c.startAt, c.guestTimezone, lang)}, ${formatTime(c.startAt, c.guestTimezone, "12h", lang)} ${zoneName(c.guestTimezone)}`;
  const fourth = kind === "cancelled_guest" ? CHANGE[lang].cancelled : kind === "rescheduled_guest" ? CHANGE[lang].moved(when) : when;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: TEMPLATE_FOR[kind],
      language: { code: lang },
      components: [
        { type: "body", parameters: [param(first, 60), param(c.eventName, 80), param(c.hostName, 80), param(fourth)].map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.manageToken }] },
      ],
    },
  };
}

/** A send that failed. `retryable`: Meta or the network may recover (5xx, 429, timeouts); a 4xx won't fix itself. */
export class WhatsAppError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code: number | null = null) {
    super(message);
    this.name = "WhatsAppError";
  }
}

/** Sends one message; returns Meta's message id (wamid), which webhook status updates refer to. */
export async function sendWhatsApp(cfg: WhatsAppConfig, body: object, fetchFn: typeof fetch = fetch): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${cfg.baseUrl}/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new WhatsAppError(`WhatsApp request failed: ${(error as Error).name}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number; error_subcode?: number } };
  const id = json.messages?.[0]?.id;
  if (res.ok && id) return { id };
  // Only the status and Meta's numeric code are kept: the message text can echo the request.
  const code = json.error?.code ?? null;
  throw new WhatsAppError(`WhatsApp ${res.status}${code === null ? "" : ` (code ${code})`}`, res.status >= 500 || res.status === 429 || code === 130429, code);
}

/** A free-form reply, allowed only inside the 24 hours after the guest wrote to us (and free there). */
export function textMessage(to: string, text: string) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } };
}

/** Meta signs each webhook POST: X-Hub-Signature-256 is sha256= and the HMAC of the raw body with the app secret. */
export function verifyWebhookSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WebhookUpdate {
  statuses: { id: string; status: string; error: string | null }[];
  messages: { from: string; text: string }[];
}

/** The parts of a webhook payload we act on: delivery statuses of our messages, and text the guests send us. */
export function parseWebhook(payload: unknown): WebhookUpdate {
  const out: WebhookUpdate = { statuses: [], messages: [] };
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of (entry as { changes?: { value?: Record<string, unknown> }[] }).changes ?? []) {
      const value = change.value ?? {};
      for (const s of (value.statuses as { id?: unknown; status?: unknown; errors?: { code?: unknown }[] }[] | undefined) ?? []) {
        if (typeof s.id !== "string" || typeof s.status !== "string") continue;
        const code = s.errors?.[0]?.code;
        out.statuses.push({ id: s.id, status: s.status, error: s.status === "failed" ? `WhatsApp delivery failed${typeof code === "number" ? ` (code ${code})` : ""}` : null });
      }
      for (const m of (value.messages as { from?: unknown; type?: unknown; text?: { body?: unknown } }[] | undefined) ?? []) {
        if (typeof m.from === "string" && m.type === "text" && typeof m.text?.body === "string") out.messages.push({ from: m.from, text: m.text.body });
      }
    }
  }
  return out;
}

/** Replies that opt a number out of all Hourhand WhatsApp messages. */
export function isStop(text: string): boolean {
  return /^(stop|unsubscribe|stop all|रोकें|बंद करें)$/i.test(text.trim());
}

export const STOP_REPLY = "You won't get any more WhatsApp messages from Hourhand. Your bookings are unchanged, and emails still come.";
