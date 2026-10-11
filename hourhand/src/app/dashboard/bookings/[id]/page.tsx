import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { bookingPayment, type BookingPaymentSummary } from "@/lib/payments/booking-payments";

const PAYMENT_WORDS: Record<BookingPaymentSummary["status"], string> = {
  pending: "waiting for the guest to pay", paid: "paid to your Razorpay account", failed: "not completed",
  refund_pending: "being refunded", refunded: "refunded to the guest",
};

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const booking = await store.getBooking(user.id, id);
  if (!booking) notFound();
  const payment = authEnabled() ? await bookingPayment(getPool(process.env.DATABASE_URL as string), user.id, booking.id) : null;
  return (
    <div>
      <h1 className="font-display text-xl text-text">Booking with {booking.invitee.name}</h1>
      <dl className="mt-4 grid max-w-md gap-3">
        <div><dt className="text-sm text-text-muted">Email</dt><dd className="text-text">{booking.invitee.email}</dd></div>
        {payment && (
          <div>
            <dt className="text-sm text-text-muted">Payment</dt>
            <dd className="text-text">
              {formatMoney(payment.amountMinor, "INR")}, {PAYMENT_WORDS[payment.status]}
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
      <Link href="/dashboard/bookings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to bookings</Link>
    </div>
  );
}
