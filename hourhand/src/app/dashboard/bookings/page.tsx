import Link from "next/link";
import { store } from "@/lib/data";

export default async function BookingsPage() {
  const user = await store.getCurrentUser();
  const bookings = await store.listBookings(user.id);
  return (
    <div>
      <h1 className="font-display text-xl text-text">Bookings</h1>
      <p className="mt-2 text-text-muted">Everyone who has booked time with you, upcoming and past.</p>
      {bookings.length === 0 ? (
        <p className="mt-6 text-text-muted">No bookings yet. Share your link and they&apos;ll show up here.</p>
      ) : (
        <ul className="mt-4">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link href={`/dashboard/bookings/${b.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">
                {b.invitee.name}{b.status === "cancelled" ? " (cancelled)" : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
