// Sending email. Resend in production; in development, without a key, messages go to an in-memory outbox and the log.

export interface Attachment { filename: string; content: string /* base64 */; contentType: string }

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend drops a repeat of the same key for 24 hours, so a retry after a crash mid-send cannot email twice. */
  idempotencyKey: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export interface Mailer { send(mail: Mail): Promise<{ id: string }> }

/** A failed send. `retryable` says whether trying again later can succeed (rate limits, outages) or not (a bad address). */
export class MailError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, retryable: boolean, status: number | null = null) {
    super(message);
    this.name = "MailError";
    this.retryable = retryable;
    this.status = status;
  }
}

type Fetch = typeof fetch;

/** Rate limits, quota, an in-flight request with the same key, and server errors can clear up; any other 4xx will not. */
export function isRetryableStatus(status: number, name?: string): boolean {
  if (status === 409) return name !== "invalid_idempotent_request"; // same key, different body: retrying can't fix it
  return status === 429 || status >= 500;
}

export function resendMailer(apiKey: string, from: string, fetchImpl: Fetch = fetch): Mailer {
  return {
    async send(mail) {
      let res: Response;
      try {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": mail.idempotencyKey },
          body: JSON.stringify({
            from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text,
            ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
            ...(mail.attachments ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new MailError(`Could not reach Resend: ${(error as Error).message}`, true);
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
      if (!res.ok || !body.id) {
        // Resend's error body names the problem; it never echoes the API key.
        throw new MailError(`Resend ${res.status} ${body.name ?? ""}: ${body.message ?? "no message"}`.trim(), isRetryableStatus(res.status, body.name), res.status);
      }
      return { id: body.id };
    },
  };
}

export interface OutboxEntry { to: string; subject: string; text: string; idempotencyKey: string; sentAt: Date }
const shared = globalThis as typeof globalThis & { __hourhandOutbox?: OutboxEntry[] };

/** The last 50 messages the log mailer "sent". Development and tests only. */
export function devOutbox(): OutboxEntry[] {
  return (shared.__hourhandOutbox ??= []);
}

export function logMailer(): Mailer {
  let n = 0;
  return {
    async send(mail) {
      const outbox = devOutbox();
      outbox.push({ to: mail.to, subject: mail.subject, text: mail.text, idempotencyKey: mail.idempotencyKey, sentAt: new Date() });
      if (outbox.length > 50) outbox.splice(0, outbox.length - 50);
      console.info(`[dev] email to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return { id: `log-${Date.now()}-${++n}` };
    },
  };
}

type Env = Record<string, string | undefined>;

/**
 * Resend when RESEND_API_KEY is set. Without it, the log mailer in development; production refuses, so a missing key
 * can never mean email silently going nowhere. HOURHAND_MAIL_TO_LOG=1 is for end-to-end tests of a production build only.
 */
export function createMailer(env: Env = process.env): Mailer {
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM must be set with RESEND_API_KEY, for example: Hourhand <booking@hourhand.cloud>");
    return resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  if (env.NODE_ENV === "production" && env.HOURHAND_MAIL_TO_LOG !== "1") {
    throw new Error("RESEND_API_KEY is not set, so email cannot be sent");
  }
  return logMailer();
}

let cached: Mailer | undefined;
export function getMailer(): Mailer {
  return (cached ??= createMailer());
}
