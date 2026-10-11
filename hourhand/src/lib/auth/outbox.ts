/** Where sign-in emails go before a mail provider is set up (B3). Development and tests only. */
export type OutboxMessage = { to: string; url: string; sentAt: Date };

const shared = globalThis as typeof globalThis & { __hourhandOutbox?: OutboxMessage[] };

export function devOutbox(): OutboxMessage[] {
  return (shared.__hourhandOutbox ??= []);
}

/**
 * Delivers a magic link. Without RESEND_API_KEY it logs the link in development so sign-in works locally;
 * in production it refuses, so a missing mail key can never mean links silently going nowhere.
 */
export async function deliverMagicLink(to: string, url: string): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    throw new Error("Sending through Resend arrives in round B3; unset RESEND_API_KEY to use the development outbox until then");
  }
  // HOURHAND_MAIL_TO_LOG=1 is for end-to-end tests of a production build only; never set it on a real deployment.
  if (process.env.NODE_ENV === "production" && process.env.HOURHAND_MAIL_TO_LOG !== "1") {
    throw new Error("RESEND_API_KEY is not set, so sign-in links cannot be emailed");
  }
  const outbox = devOutbox();
  outbox.push({ to, url, sentAt: new Date() });
  if (outbox.length > 50) outbox.splice(0, outbox.length - 50);
  console.info(`[dev] magic link for ${to}: ${url}`);
}
