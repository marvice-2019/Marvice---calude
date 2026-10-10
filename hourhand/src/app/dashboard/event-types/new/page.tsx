import Link from "next/link";

export default function NewEventTypePage() {
  return (
    <div>
      <h1 className="font-display text-xl text-text">New event type</h1>
      <p className="mt-2 text-text-muted">Set the name, length and where you meet, then share the link.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to event types</Link></li>
      </ul>
    </div>
  );
}
