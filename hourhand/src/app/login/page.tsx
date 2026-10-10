import Link from "next/link";

export default function LoginPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Log in</h1>
      <p className="mt-2 text-text-muted">Sign in to manage your booking links and see who has booked.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/onboarding/calendar" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">New here? Get set up</Link></li>
      </ul>
    </div>
  );
}
