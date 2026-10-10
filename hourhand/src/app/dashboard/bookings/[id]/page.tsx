import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await store.getCurrentUser();
  const booking = await store.getBooking(user.id, id);
  if (!booking) notFound();
  return (
    <div>
      <h1 className="font-display text-xl text-text">Booking with {booking.invitee.name}</h1>
      <dl className="mt-4 grid max-w-md gap-3">
        <div><dt className="text-sm text-text-muted">Email</dt><dd className="text-text">{booking.invitee.email}</dd></div>
        {booking.invitee.phone && <div><dt className="text-sm text-text-muted">Phone</dt><dd className="text-text">{booking.invitee.phone}</dd></div>}
        {booking.invitee.answers.map((a) => (
          <div key={a.questionId}><dt className="text-sm text-text-muted">{a.label}</dt><dd className="whitespace-pre-line text-text">{a.answer}</dd></div>
        ))}
      </dl>
      <Link href="/dashboard/bookings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to bookings</Link>
    </div>
  );
}
