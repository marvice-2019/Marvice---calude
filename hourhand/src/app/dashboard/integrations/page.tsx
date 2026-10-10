import Link from "next/link";

export default function IntegrationsPage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">Integrations</h1>
      <p className="mt-2 text-text-muted">Connect video, payments and messaging tools to your booking links.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/calendars" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Calendars</Link></li>
        <li><Link href="/dashboard/settings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Settings</Link></li>
      </ul>
    </div>
  );
}
