import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";

const tabs = ["Details", "Scheduling rules", "Booking form", "Notifications"];

export default async function EventTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await store.getCurrentUser();
  const eventType = await store.getEventType(user.id, id);
  if (!eventType) notFound();
  return (
    <div>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">Change how this booking link works and what people see when they book.</p>
      <ul aria-label="Sections" className="mt-6 flex flex-wrap gap-2 border-b border-border">
        {tabs.map((tab, i) => (
          <li key={tab} aria-current={i === 0 ? "page" : undefined} className={`px-3 py-2 text-sm ${i === 0 ? "border-b-2 border-accent font-semibold text-text" : "text-text-muted"}`}>
            {tab}
          </li>
        ))}
      </ul>
      <Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Back to event types</Link>
    </div>
  );
}
