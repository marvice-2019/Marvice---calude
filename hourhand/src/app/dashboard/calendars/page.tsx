import Link from "next/link";

export default function CalendarsPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Calendars</h1>
      <p className="mt-2 text-text-muted">Connect the calendars we check so nobody books you when you are busy.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/integrations" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Integrations</Link></li>
        <li><Link href="/dashboard/availability" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Availability</Link></li>
      </ul>
    </div>
  );
}
