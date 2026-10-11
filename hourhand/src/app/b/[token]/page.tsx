import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { ManageBooking } from "@/components/ManageBooking";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isUnpaidRelease } from "@/lib/booking-reasons";
import { store } from "@/lib/data";
import { formatDate, zoneName } from "@/lib/format";
import { GUEST_LOCATION_LABELS as locationLabels } from "@/lib/location-labels";

export const dynamic = "force-dynamic";


export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await store.getBookingByManageToken(token);
  if (!booking) notFound();
  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) notFound();
  const tz = booking.invitee.timezone;
  const cancelled = booking.status === "cancelled";
  const pending = booking.status === "pending_payment";
  // A hold that ran out before the guest paid: say so plainly rather than "cancelled".
  const unpaid = cancelled && isUnpaidRelease(booking.cancelReason);

  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-xl text-text">Your booking</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">What</dt><dd className="text-text">{eventType.name} with {host.name}</dd></div>
          <div>
            <dt className="text-sm text-text-muted">When</dt>
            <dd className={cancelled ? "text-text-muted line-through" : "text-text"}>
              {formatDate(booking.startAt, tz)}, <LocalTime date={booking.startAt} tz={tz} /> to <LocalTime date={booking.endAt} tz={tz} /> ({zoneName(tz)})
            </dd>
          </div>
          {booking.locationKind && <div><dt className="text-sm text-text-muted">Where</dt><dd className="text-text">{locationLabels[booking.locationKind]}{booking.joinUrl && booking.status === "confirmed" && <> · <a href={booking.joinUrl} className="font-semibold text-accent underline" rel="noopener noreferrer" target="_blank">Join the call</a></>}</dd></div>}
          <div><dt className="text-sm text-text-muted">Booked for</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      {cancelled ? (
        <>
          <p className="mt-6 font-semibold text-text" role="status">
            {unpaid ? "The payment wasn't completed, so this time was released." : "This booking is cancelled."}
          </p>
          <Link href={`/${host.slug}/${eventType.slug}`} className={`mt-3 ${buttonClasses({ variant: "primary" })}`}>Book another time</Link>
        </>
      ) : pending ? (
        <p className="mt-6 max-w-md text-text" role="status">
          Waiting for your payment. This time is held for you until{" "}
          {booking.holdExpiresAt ? <LocalTime date={booking.holdExpiresAt} tz={tz} /> : "a few minutes from now"}.
          If you&apos;ve paid, it confirms here within a minute.
        </p>
      ) : (
        <ManageBooking token={token} slug={host.slug} event={eventType.slug} bookingWindowDays={eventType.bookingWindowDays} hostName={host.name} />
      )}
    </main>
  );
}
