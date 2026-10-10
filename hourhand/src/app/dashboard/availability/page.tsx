import Link from "next/link";

export default function AvailabilityPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Availability</h1>
      <p className="mt-2 text-text-muted">Set the hours people can book you each week, plus days off.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Event types</Link></li>
        <li><Link href="/dashboard/calendars" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Calendars</Link></li>
      </ul>
    </div>
  );
}
