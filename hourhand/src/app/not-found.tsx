import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-16">
      <h1 className="font-display text-xl text-text">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-text-muted">The link may be old or have a typo. Check it with whoever sent it to you.</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Go to the home page</Link>
    </main>
  );
}
