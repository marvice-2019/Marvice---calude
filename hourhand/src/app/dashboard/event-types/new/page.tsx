import Link from "next/link";
import { EventTypeEditor } from "@/components/EventTypeEditor";
import { store } from "@/lib/data";
import { NEW_EVENT_TYPE_FORM } from "@/lib/event-types";

export const dynamic = "force-dynamic";

export default async function NewEventTypePage() {
  const user = await store.getCurrentUser();
  return (
    <div>
      <Link href="/dashboard/event-types" className="inline-flex min-h-11 items-center font-semibold text-accent underline">Back to event types</Link>
      <h1 className="mt-2 font-display text-xl text-text">New event type</h1>
      <p className="mt-2 text-text-muted">Set the name, length and where you meet, then share the link.</p>
      <EventTypeEditor id={null} userSlug={user.slug} initial={NEW_EVENT_TYPE_FORM} initialQuestions={[]} />
    </div>
  );
}
