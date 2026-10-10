import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await store.getBookingByManageToken(token);
  if (!booking) notFound();
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-xl text-text">Your booking</h1>
      <p className="mt-2 text-text-muted">Check the details, pick a new time, or cancel if your plans change.</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Done</Link>
    </main>
  );
}
