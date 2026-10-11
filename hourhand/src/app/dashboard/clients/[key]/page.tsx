import Link from "next/link";
import { notFound } from "next/navigation";
import { saveClientNoteAction } from "../actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireUser } from "@/lib/auth/session";
import { clientKey, summarizeClients } from "@/lib/clients";
import { store } from "@/lib/data";
import { formatDate, formatTime } from "@/lib/format";
import { focusRing } from "@/components/ui/focus";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const { key } = await params;
  const { saved, error } = await searchParams;
  const all = await store.listBookings(user.id);
  const client = summarizeClients(all, new Date()).find((c) => c.key === key);
  if (!client) notFound();
  const history = all.filter((b) => clientKey(b.invitee.email) === key && b.status !== "pending_payment").sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  const note = await store.getClientNote(user.id, client.email);
  const tz = user.timezone;
  return (
    <div>
      <Link href="/dashboard/clients" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">All clients</Link>
      <h1 className="font-display text-xl text-text">{client.name}</h1>
      <p className="mt-1 text-text-muted">{client.email}{client.phone && ` · ${client.phone}`}</p>
      <dl className="mt-4 flex flex-wrap gap-6">
        <div><dt className="text-sm text-text-muted">Sessions</dt><dd className="text-lg font-semibold text-text">{client.sessions}</dd></div>
        <div><dt className="text-sm text-text-muted">Coming up</dt><dd className="text-lg font-semibold text-text">{client.upcoming}</dd></div>
        <div><dt className="text-sm text-text-muted">No-shows</dt><dd className="text-lg font-semibold text-text">{client.noShows}</dd></div>
        <div><dt className="text-sm text-text-muted">Client since</dt><dd className="text-lg font-semibold text-text">{formatDate(client.firstAt, tz)}</dd></div>
      </dl>

      <Card className="mt-6 max-w-xl">
        <form action={saveClientNoteAction} className="grid gap-3">
          <input type="hidden" name="key" value={key} />
          <label htmlFor="note" className="font-semibold text-text">Private note</label>
          <p className="text-sm text-text-muted">Only you see this. It shows on each of {client.name}&apos;s bookings.</p>
          <textarea id="note" name="note" rows={6} maxLength={5000} defaultValue={note} placeholder="What you're working on together, preferences, what you agreed."
            className={`block w-full rounded-md border border-border-input bg-card p-3 text-base text-text ${focusRing}`} />
          {saved && <p className="text-success" role="status">Saved.</p>}
          {error === "too_long" && <p className="text-danger" role="alert">Keep the note under 5000 characters.</p>}
          <div><Button type="submit">Save note</Button></div>
        </form>
      </Card>

      <section aria-labelledby="history" className="mt-8">
        <h2 id="history" className="font-semibold text-text">History</h2>
        <ul className="mt-2 grid gap-2">
          {history.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4">
              <Link href={`/dashboard/bookings/${b.id}`} className={`inline-flex min-h-11 items-center font-semibold text-accent underline ${b.status === "cancelled" ? "line-through" : ""}`}>
                {formatDate(b.startAt, tz)}, {formatTime(b.startAt, tz)}
              </Link>
              {b.status === "cancelled" && <span className="text-sm text-text-muted">Cancelled</span>}
              {b.invitee.noShowAt && <span className="rounded-md bg-warning-bg px-2 py-0.5 text-sm text-warning">No-show</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
