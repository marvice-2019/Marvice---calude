import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LocalTime } from "@/components/LocalTime";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isUnpaidRelease } from "@/lib/booking-reasons";
import { store } from "@/lib/data";
import { formatDate, zoneName } from "@/lib/format";
import { GUEST_LOCATION_LABELS as locationLabels } from "@/lib/location-labels";

export const dynamic = "force-dynamic";


export default async function BookedPage({ params }: { params: Promise<{ slug: string; event: string; bookingId: string }> }) {
  const { slug, bookingId } = await params;
  const host = await store.getUserBySlug(slug);
  const booking = host && (await store.getBooking(host.id, bookingId));
  if (!host || !booking) notFound();
  const eventType = await store.getEventType(host.id, booking.eventTypeId);
  const tz = booking.invitee.timezone;
  if (booking.status === "pending_payment") {
    return (
      <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
        <h1 className="font-display text-xl text-text">Confirming your payment…</h1>
        <p className="mt-2 max-w-md text-text-muted" role="status">
          This usually takes a few seconds. Your time is held{booking.holdExpiresAt && <> until <LocalTime date={booking.holdExpiresAt} tz={tz} /></>}.
          If you closed Razorpay without paying, go back and pick the time again.
        </p>
        <AutoRefresh />
      </main>
    );
  }
  if (booking.status === "cancelled") {
    const unpaid = isUnpaidRelease(booking.cancelReason);
    return (
      <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
        <h1 className="font-display text-xl text-text">{unpaid ? "The payment wasn't completed" : "This booking is cancelled"}</h1>
        <p className="mt-2 max-w-md text-text-muted">{unpaid ? "So the time was released. If money left your account, it's refunded automatically." : "Nothing more to do here."}</p>
        <Link href={`/${host.slug}/${eventType?.slug ?? ""}`} className={`mt-4 ${buttonClasses({ variant: "primary" })}`}>Book a time</Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-xl text-text">You&apos;re booked.</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">What</dt><dd className="text-text">{eventType?.name} with {host.name}</dd></div>
          <div>
            <dt className="text-sm text-text-muted">When</dt>
            <dd className="text-text">{formatDate(booking.startAt, tz)}, <LocalTime date={booking.startAt} tz={tz} /> to <LocalTime date={booking.endAt} tz={tz} /> ({zoneName(tz)})</dd>
          </div>
          {booking.locationKind && <div><dt className="text-sm text-text-muted">Where</dt><dd className="text-text">{locationLabels[booking.locationKind]}{booking.joinUrl && booking.status === "confirmed" && <> · <a href={booking.joinUrl} className="font-semibold text-accent underline" rel="noopener noreferrer" target="_blank">Join the call</a></>}</dd></div>}
          <div><dt className="text-sm text-text-muted">Booked for</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      <p className="mt-4 text-text-muted">Keep this link to come back to your booking later.</p>
      <Link href={`/b/${booking.invitee.manageToken}`} className={`mt-2 ${buttonClasses({ variant: "secondary" })}`}>Manage this booking</Link>
    </main>
  );
}
