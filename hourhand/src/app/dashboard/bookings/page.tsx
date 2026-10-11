import Link from "next/link";
import { isUnpaidRelease } from "@/lib/booking-reasons";
import { upcomingFirst } from "@/lib/booking";
import { store } from "@/lib/data";
import { formatDate, formatTime, zoneName } from "@/lib/format";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const user = await requireUser();
  // Holds that lapsed unpaid were never bookings the host had; leave them out.
  const all = (await store.listBookings(user.id)).filter((b) => !(b.status === "cancelled" && isUnpaidRelease(b.cancelReason)));
  const { bookings, now } = upcomingFirst(all);
  const tz = user.timezone;
  return (
    <div>
      <h1 className="font-display text-xl text-text">Bookings</h1>
      <p className="mt-2 text-text-muted">Everyone who has booked time with you, upcoming first. Times in {zoneName(tz)}.</p>
      {bookings.length === 0 ? (
        <p className="mt-6 text-text-muted">No bookings yet. Share your link and they&apos;ll show up here.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {bookings.map((b) => {
            const cancelled = b.status === "cancelled";
            const pending = b.status === "pending_payment";
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-card px-4 py-2">
                <Link href={`/dashboard/bookings/${b.id}`} className={`inline-flex min-h-11 items-center font-semibold text-accent underline ${cancelled ? "line-through" : ""}`}>
                  {b.invitee.name}
                </Link>
                <span className="text-text">{formatDate(b.startAt, tz)}, {formatTime(b.startAt, tz)}</span>
                <span className={`rounded-md px-2 py-0.5 text-sm ${cancelled ? "bg-danger-bg text-danger" : pending ? "bg-warning-bg text-warning" : "bg-success-bg text-success"}`}>
                  {cancelled ? "Cancelled" : pending ? "Awaiting payment" : b.endAt.getTime() < now ? "Done" : "Confirmed"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
