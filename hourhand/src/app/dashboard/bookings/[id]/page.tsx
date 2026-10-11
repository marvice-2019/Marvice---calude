import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { freeSlots } from "@/lib/booking";
import { store } from "@/lib/data";
import { clientKey, sessionNumber } from "@/lib/clients";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/plans";
import { formatDate, formatTime, zoneName } from "@/lib/format";
import { getPool } from "@/lib/data/pg-store";
import { bookingPayment, DEPOSIT_HOLD_MS, type BookingPaymentSummary } from "@/lib/payments/booking-payments";
import { GUEST_LOCATION_LABELS } from "@/lib/location-labels";
import { waLink, waNumber, whatsappMessage, type WhatsAppKind } from "@/lib/whatsapp";
import { cancelAsHost, rescheduleAsHost, setNoShow } from "./actions";

const PAYMENT_WORDS: Record<BookingPaymentSummary["status"], string> = {
  pending: "waiting for the guest to pay", paid: "paid to your Razorpay account", failed: "not completed",
  refund_pending: "being refunded", refunded: "refunded to the guest",
};

const DONE: Record<string, string> = {
  cancelled: "Booking cancelled. We've emailed the guest, and a paid booking is refunded in full.",
  rescheduled: "Booking moved. We've emailed the guest the new time.",
  no_show: "Marked as a no-show.",
  no_show_undone: "No-show undone.",
};
const ERRORS: Record<string, string> = {
  not_found: "That booking isn't one of yours, or it no longer exists.",
  reason_too_long: "Keep the reason under 500 characters.",
  not_cancellable: "Only upcoming confirmed bookings can be cancelled.",
  slot_taken: "That time was just taken. Pick another.",
  not_movable: "This booking can't be moved. Only upcoming confirmed bookings can.",
  bad_time: "That time didn't come through. Pick one from the list.",
  not_started: "You can mark a no-show once the booking has started.",
};
const DAY = 86_400_000;

export const dynamic = "force-dynamic";

type Query = { done?: string; error?: string; confirm?: string; reschedule?: string };

export default async function BookingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser();
  const booking = await store.getBooking(user.id, id);
  if (!booking) notFound();
  const now = new Date();
  const tz = user.timezone;
  const confirmed = booking.status === "confirmed";
  const upcoming = confirmed && booking.startAt > now;
  const started = confirmed && booking.startAt <= now;
  // Next 14 days of times the host is free, not counting this booking's own slot, grouped by day in the host's zone.
  const eventType = upcoming && query.reschedule ? await store.getEventType(user.id, booking.eventTypeId) : null;
  const slots = eventType ? await freeSlots(store, user, eventType, now, new Date(now.getTime() + 14 * DAY), now, booking.id) : [];
  const byDay = new Map<string, Date[]>();
  for (const s of slots) byDay.set(formatDate(s, tz), [...(byDay.get(formatDate(s, tz)) ?? []), s]);
  const key = randomUUID();
  const done = query.done && Object.hasOwn(DONE, query.done) ? DONE[query.done] : null;
  const error = query.error && Object.hasOwn(ERRORS, query.error) ? ERRORS[query.error] : null;
  const payment = authEnabled() ? await bookingPayment(getPool(process.env.DATABASE_URL as string), user.id, booking.id) : null;
  const whatsapp = upcoming ? await whatsappLinks(user, booking) : null;
  const allBookings = await store.listBookings(user.id);
  const series = booking.seriesId ? allBookings.filter((b) => b.seriesId === booking.seriesId) : [];
  const nth = sessionNumber(allBookings, booking);
  const clientNote = await store.getClientNote(user.id, booking.invitee.email);
  const laterWeeks = series.filter((b) => (b.seriesIndex ?? 0) > (booking.seriesIndex ?? 0) && b.status === "confirmed" && b.startAt > now).length;
  return (
    <div>
      <h1 className="font-display text-xl text-text">Booking with {booking.invitee.name}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {nth > 1 ? `Returning client, session ${nth}` : nth === 1 ? "First session" : ""}{nth > 0 && " · "}
        <Link href={`/dashboard/clients/${clientKey(booking.invitee.email)}`} className="font-semibold text-accent underline">Client history and notes</Link>
      </p>
      {clientNote && <p className="mt-3 max-w-xl whitespace-pre-line rounded-md bg-surface p-3 text-sm text-text"><span className="font-semibold">Your note: </span>{clientNote}</p>}
      {done && <p role="status" className="mt-4 max-w-xl text-success">{done}</p>}
      {error && <p role="alert" className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
      <dl className="mt-4 grid max-w-md gap-3">
        <div>
          <dt className="text-sm text-text-muted">When</dt>
          <dd className="text-text">
            {formatDate(booking.startAt, tz)}, {formatTime(booking.startAt, tz)} ({zoneName(tz)})
            {booking.status === "cancelled" && <span className="ml-2 rounded-md bg-danger-bg px-2 py-0.5 text-sm text-danger">Cancelled</span>}
            {booking.status === "pending_payment" && <span className="ml-2 rounded-md bg-warning-bg px-2 py-0.5 text-sm text-warning">Awaiting payment</span>}
            {booking.invitee.noShowAt && <span className="ml-2 rounded-md bg-warning-bg px-2 py-0.5 text-sm text-warning">No-show</span>}
            {confirmed && booking.invitee.runningLateMinutes && (
              <span className="ml-2 rounded-md bg-warning-bg px-2 py-0.5 text-sm text-warning">
                Running {booking.invitee.runningLateMinutes} min late{booking.invitee.runningLateAt && ` (said at ${formatTime(booking.invitee.runningLateAt, tz)})`}
              </span>
            )}
          </dd>
          {series.length > 1 && <dd className="text-sm text-text-muted">Week {booking.seriesIndex} of {new Set(series.map((b) => b.seriesIndex)).size}, every week at this time</dd>}
        </div>
        <div><dt className="text-sm text-text-muted">Email</dt><dd className="text-text">{booking.invitee.email}</dd></div>
        {payment && (
          <div>
            <dt className="text-sm text-text-muted">Payment</dt>
            <dd className="text-text">
              {payment.kind === "deposit" && "Deposit: "}{formatMoney(payment.amountMinor, "INR")}, {payment.kind === "deposit" && payment.status === "paid" && booking.invitee.noShowAt ? "kept for the no-show" : PAYMENT_WORDS[payment.status]}
              {payment.kind === "deposit" && payment.status === "paid" && !booking.invitee.noShowAt && confirmed && (
                <span className="block text-sm text-text-muted">Refunded on {formatDate(new Date(booking.endAt.getTime() + DEPOSIT_HOLD_MS), tz)}, {formatTime(new Date(booking.endAt.getTime() + DEPOSIT_HOLD_MS), tz)} unless you mark a no-show before then.</span>
              )}
              {payment.status === "refund_pending" && payment.lastError && (
                <span className="block text-sm text-danger">Razorpay hasn&apos;t accepted the refund yet ({payment.lastError.slice(0, 120)}). Hourhand keeps retrying; check your Razorpay balance.</span>
              )}
            </dd>
          </div>
        )}
        {booking.invitee.phone && <div><dt className="text-sm text-text-muted">Phone</dt><dd className="text-text">{booking.invitee.phone}</dd></div>}
        {booking.invitee.answers.map((a) => (
          <div key={a.questionId}><dt className="text-sm text-text-muted">{a.label}</dt><dd className="whitespace-pre-line text-text">{a.answer}</dd></div>
        ))}
      </dl>
      {upcoming && (
        <section aria-labelledby="whatsapp" className="mt-6 grid max-w-xl gap-2">
          <h2 id="whatsapp" className="font-display text-lg text-text">Message on WhatsApp</h2>
          {whatsapp ? (
            <>
              <p className="text-sm text-text-muted">Opens WhatsApp on your phone or computer with the message written. You send it from your own number.</p>
              <div className="flex flex-wrap gap-2">
                {whatsapp.map((w) => (
                  <a key={w.kind} href={w.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 font-semibold text-accent underline">
                    {w.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              {booking.invitee.phone
                ? `${booking.invitee.name}'s number (${booking.invitee.phone}) has no country code, so Hourhand won't guess where to send it. Check it with them first.`
                : `${booking.invitee.name} didn't leave a WhatsApp number, so you can only email them.`}
            </p>
          )}
        </section>
      )}
      {upcoming && (
        <section aria-labelledby="actions" className="mt-6 grid max-w-xl gap-4">
          <h2 id="actions" className="font-display text-lg text-text">Change this booking</h2>
          {query.confirm === "cancel" ? (
            <form action={cancelAsHost} className="grid gap-2">
              <input type="hidden" name="bookingId" value={booking.id} />
              <label htmlFor="reason" className="text-sm text-text-muted">Reason for {booking.invitee.name} (optional)</label>
              <textarea id="reason" name="reason" maxLength={500} rows={3} className="rounded-md border border-border bg-card p-2 text-text" />
              {laterWeeks > 0 && (
                <label className="flex min-h-11 items-center gap-3 text-text">
                  <input type="checkbox" name="laterWeeks" className="h-5 w-5 accent-accent" />
                  Also cancel the {laterWeeks === 1 ? "next week" : `${laterWeeks} later weeks`} in this series
                </label>
              )}
              <p className="text-sm text-text-muted">We&apos;ll email {booking.invitee.name} that you cancelled. A paid booking is refunded in full.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger">Yes, cancel</Button>
                <Link href={`/dashboard/bookings/${booking.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">Keep it</Link>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-4">
              <Link href={`/dashboard/bookings/${booking.id}?confirm=cancel`} className="inline-flex min-h-11 items-center font-semibold text-danger underline">Cancel booking</Link>
              <Link href={`/dashboard/bookings/${booking.id}?reschedule=1`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">Move to another time</Link>
            </div>
          )}
          {query.reschedule && (
            <div>
              <h3 className="font-semibold text-text">Pick a new time ({zoneName(tz)})</h3>
              {byDay.size === 0 ? (
                <p className="mt-2 text-text-muted">No free times in the next 14 days.</p>
              ) : (
                [...byDay].map(([day, times]) => (
                  <div key={day} className="mt-3">
                    <h4 className="text-sm text-text-muted">{day}</h4>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {times.map((t) => (
                        <li key={t.toISOString()}>
                          <form action={rescheduleAsHost}>
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <input type="hidden" name="start" value={t.toISOString()} />
                            {/* One key per time: clicking a second time on a stale page is refused instead of silently repeating the first move. */}
                            <input type="hidden" name="key" value={`${key}:${t.toISOString()}`} />
                            <Button type="submit" variant="secondary">{formatTime(t, tz)}</Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}
      {started && (
        <form action={setNoShow} className="mt-6">
          <input type="hidden" name="bookingId" value={booking.id} />
          <input type="hidden" name="on" value={booking.invitee.noShowAt ? "0" : "1"} />
          <Button type="submit" variant="secondary">{booking.invitee.noShowAt ? "Undo no-show" : "Mark as no-show"}</Button>
        </form>
      )}
      <Link href="/dashboard/bookings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to bookings</Link>
    </div>
  );
}

const WHATSAPP_LABELS: Record<WhatsAppKind, string> = { confirmation: "Send confirmation", reminder: "Send reminder", manage: "Send change-or-cancel link" };

/** One wa.me link per message, or null when the guest left no usable number. */
async function whatsappLinks(
  user: { id: string; name: string },
  booking: NonNullable<Awaited<ReturnType<typeof store.getBooking>>>,
): Promise<{ kind: WhatsAppKind; label: string; href: string }[] | null> {
  const number = waNumber(booking.invitee.phone);
  if (!number) return null;
  const [eventType, locations, h] = await Promise.all([
    store.getEventType(user.id, booking.eventTypeId), store.listEventLocations(user.id, booking.eventTypeId), headers(),
  ]);
  const origin = process.env.BETTER_AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const kind = booking.locationKind;
  const value = locations.find((l) => l.kind === kind)?.value ?? null;
  const where = kind ? `${GUEST_LOCATION_LABELS[kind]}${booking.joinUrl ? `: ${booking.joinUrl}` : value ? `: ${value}` : ""}` : null;
  const ctx = {
    guestName: booking.invitee.name, hostName: user.name, eventName: eventType?.name ?? "booking", startAt: booking.startAt,
    guestTimezone: booking.invitee.timezone, where, manageUrl: `${origin.replace(/\/+$/, "")}/b/${booking.invitee.manageToken}`,
  };
  return (Object.keys(WHATSAPP_LABELS) as WhatsAppKind[]).map((k) => ({ kind: k, label: WHATSAPP_LABELS[k], href: waLink(number, whatsappMessage(k, ctx)) }));
}
