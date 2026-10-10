import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { ManageBooking } from "@/components/ManageBooking";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { store, type LocationKind } from "@/lib/data";
import { formatDate, zoneName } from "@/lib/format";

export const dynamic = "force-dynamic";

const locationLabels: Record<LocationKind, string> = {
  google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", phone_host_calls: "Phone call (the host calls you)",
  phone_guest_calls: "Phone call (you call the host)", in_person: "In person", custom: "Details from the host", ask_guest: "Your chosen location",
};

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await store.getBookingByManageToken(token);
  if (!booking) notFound();
  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) notFound();
  const tz = booking.invitee.timezone;
  const cancelled = booking.status === "cancelled";

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
          {booking.locationKind && <div><dt className="text-sm text-text-muted">Where</dt><dd className="text-text">{locationLabels[booking.locationKind]}</dd></div>}
          <div><dt className="text-sm text-text-muted">Booked for</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      {cancelled ? (
        <>
          <p className="mt-6 font-semibold text-text" role="status">This booking is cancelled.</p>
          <Link href={`/${host.slug}/${eventType.slug}`} className={`mt-3 ${buttonClasses({ variant: "primary" })}`}>Book another time</Link>
        </>
      ) : (
        <ManageBooking token={token} slug={host.slug} event={eventType.slug} bookingWindowDays={eventType.bookingWindowDays} hostName={host.name} />
      )}
    </main>
  );
}
