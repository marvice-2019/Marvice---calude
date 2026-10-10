import Link from "next/link";

export default async function BookedPage({ params }: { params: Promise<{ slug: string; event: string; bookingId: string }> }) {
  const { slug } = await params;
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-xl text-text">You&apos;re booked</h1>
      <p className="mt-2 text-text-muted">The details are on their way to your inbox. Add it to your calendar so you don&apos;t miss it.</p>
      <Link href={`/${slug}`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Book another time</Link>
    </main>
  );
}
