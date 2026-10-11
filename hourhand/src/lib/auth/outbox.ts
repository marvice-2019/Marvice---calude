import { createHash } from "node:crypto";
import { getMailer } from "../mail/mailer";
import { renderMagicLink } from "../mail/templates";

/**
 * Emails a sign-in link straight away; it is not queued, because the person is waiting for it. Without RESEND_API_KEY
 * the development mailer logs it (and production refuses: see createMailer).
 */
export async function deliverMagicLink(to: string, url: string): Promise<void> {
  const mail = renderMagicLink(url);
  // Each link is single-use, so a hash of it is a safe idempotency key: a double submit can't send two copies.
  const idempotencyKey = `magic-${createHash("sha256").update(url).digest("hex")}`;
  await getMailer().send({ ...mail, to, idempotencyKey });
  if (!process.env.RESEND_API_KEY) console.info(`[dev] magic link for ${to}: ${url}`);
}
