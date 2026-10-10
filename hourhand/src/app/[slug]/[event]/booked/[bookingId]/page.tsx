import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { store, type LocationKind } from "@/lib/data";
import { formatDate, formatTime, zoneName } from "@/lib/format";

export const dynamic = "force-dynamic";

const locationLabels: Record<LocationKind, string> = {
  google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", phone_host_calls: "Phone call (the host calls you)",
  phone_guest_calls: "Phone call (you call the host)", in_person: "In person", custom: "Details from the host", ask_guest: "Your chosen location",
};

export default async function BookedPage({ params }: { params: Promise<{ slug: string; event: string; bookingId: string }> }) {
  const { slug, bookingId } = await params;
  const host = await store.getUserBySlug(slug);
  const booking = host && (await store.getBooking(host.id, bookingId));
  if (!host || !booking) notFound();
  const eventType = await store.getEventType(host.id, booking.eventTypeId);
  const tz = booking.invitee.timezone;
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-xl text-text">You&apos;re booked.</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">What</dt><dd className="text-text">{eventType?.name} with {host.name}</dd></div>
          <div>
            <dt className="text-sm text-text-muted">When</dt>
            <dd className="text-text">{formatDate(booking.startAt, tz)}, {formatTime(booking.startAt, tz)} to {formatTime(booking.endAt, tz)} ({zoneName(tz)})</dd>
          </div>
          {booking.locationKind && <div><dt className="text-sm text-text-muted">Where</dt><dd className="text-text">{locationLabels[booking.locationKind]}</dd></div>}
          <div><dt className="text-sm text-text-muted">Booked for</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      <p className="mt-4 text-text-muted">Keep this link to come back to your booking later.</p>
      <Link href={`/b/${booking.invitee.manageToken}`} className={`mt-2 ${buttonClasses({ variant: "secondary" })}`}>Manage this booking</Link>
    </main>
  );
}
