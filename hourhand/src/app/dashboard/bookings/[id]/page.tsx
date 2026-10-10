import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await store.getCurrentUser();
  const booking = await store.getBooking(user.id, id);
  if (!booking) notFound();
  return (
    <div>
      <h1 className="font-display text-xl text-text">Booking with {booking.invitee.name}</h1>
      <p className="mt-2 text-text-muted">The time, the guest&apos;s answers, and options to reschedule or cancel.</p>
      <Link href="/dashboard/bookings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to bookings</Link>
    </div>
  );
}
