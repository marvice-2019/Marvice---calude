import Link from "next/link";

export default function OnboardingHoursPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Set your hours</h1>
      <p className="mt-2 text-text-muted">Pick the days and hours people can book you. You can change this later.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Finish and see your links</Link></li>
      </ul>
    </div>
  );
}
