import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BookingFlow } from "@/components/BookingFlow";
import { BookingFooter } from "@/components/BookingFooter";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { store } from "@/lib/data";
import { getPool } from "@/lib/data/pg-store";
import { formatDate, formatTime, zoneName } from "@/lib/format";
import { purchaseByToken, purchaseSessions } from "@/lib/packages/packages";

export const dynamic = "force-dynamic";

/** The buyer's own page for a session package: what's left, until when, their sessions, and booking the next one. */
export default async function PackagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = authEnabled() ? getPool(process.env.DATABASE_URL as string) : null;
  const purchase = db ? await purchaseByToken(db, token) : null;
  if (!purchase) notFound();
  const [host, eventType] = await Promise.all([store.getUser(purchase.hostId), store.getEventType(purchase.hostId, purchase.eventTypeId)]);
  if (!host || !eventType) notFound();
  const now = new Date();
  const left = purchase.sessions - purchase.used;
  const expired = purchase.expiresAt !== null && purchase.expiresAt <= now;
  const sessions = await purchaseSessions(db!, purchase.id);
  const questions = (await store.listCustomQuestions(host.id, eventType.id))
    .sort((a, b) => a.position - b.position)
    .map(({ id, label, kind, required }) => ({ id, label, kind, required }));
  const tz = host.timezone;

  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <p className="text-sm font-semibold text-text-muted">{host.name}</p>
      <h1 className="font-display text-xl text-text">Your sessions</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">Package</dt><dd className="text-text">{purchase.sessions} × {eventType.name}</dd></div>
          {purchase.status === "paid" && (
            <>
              <div><dt className="text-sm text-text-muted">Left to book</dt><dd className="text-lg font-semibold text-text">{left} of {purchase.sessions}</dd></div>
              <div><dt className="text-sm text-text-muted">Book by</dt><dd className={expired ? "text-danger" : "text-text"}>{formatDate(purchase.expiresAt!, tz)}</dd></div>
            </>
          )}
          <div><dt className="text-sm text-text-muted">For</dt><dd className="text-text">{purchase.guestName}, {purchase.guestEmail}</dd></div>
        </dl>
      </Card>

      {purchase.status === "pending" && (
        <div className="mt-6 max-w-md" role="status">
          <p className="text-text">Waiting for your payment to be confirmed. This usually takes a few seconds.</p>
          <AutoRefresh />
        </div>
      )}
      {purchase.status === "failed" && <p className="mt-6 max-w-md text-danger" role="alert">No payment came through for this package, so nothing was charged. Buy it again from {host.name}&apos;s booking page.</p>}

      {sessions.length > 0 && (
        <section aria-labelledby="booked" className="mt-8 max-w-md">
          <h2 id="booked" className="font-semibold text-text">Booked</h2>
          <ul className="mt-2 grid gap-2">
            {sessions.map((b) => (
              <li key={b.id} className={b.status === "cancelled" ? "text-text-muted line-through" : "text-text"}>
                {formatDate(b.startAt, b.timezone)}, {formatTime(b.startAt, b.timezone)} {zoneName(b.timezone)}
                {b.status === "confirmed" && <> · <Link href={`/b/${b.manageToken}`} className="font-semibold text-accent underline">Change</Link></>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {purchase.status === "paid" && !expired && left > 0 && (
        <section aria-labelledby="book" className="mt-8">
          <h2 id="book" className="font-semibold text-text">Book a session</h2>
          <BookingFlow
            slug={host.slug} event={eventType.slug} host={{ name: host.name, timezone: host.timezone }} bookingWindowDays={eventType.bookingWindowDays}
            questions={questions} packageToken={token} maxWeeks={Math.min(left, eventType.priceMinor === null ? eventType.maxRepeats : 1)}
          />
        </section>
      )}
      {purchase.status === "paid" && (expired || left === 0) && (
        <p className="mt-8 max-w-md text-text">{expired ? "This package has ended." : "You've booked every session in this package."}</p>
      )}
      <BookingFooter hostId={host.id} />
    </main>
  );
}
