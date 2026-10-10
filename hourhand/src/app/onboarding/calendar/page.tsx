import Link from "next/link";

export default function OnboardingCalendarPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Connect your calendar</h1>
      <p className="mt-2 text-text-muted">Connect a calendar so we only offer times when you are free.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/onboarding/hours" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Next: your hours</Link></li>
      </ul>
    </div>
  );
}
