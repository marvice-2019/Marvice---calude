import Link from "next/link";
import { revokeLink } from "./actions";
import { LocalTime } from "@/components/LocalTime";
import { SingleUseLinkForm } from "@/components/LinkForms";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireHost } from "@/lib/auth/session";
import { store } from "@/lib/data";
import type { BookingLink } from "@/lib/data/types";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATE: Record<BookingLink["state"], { label: string; className: string }> = {
  open: { label: "Open", className: "bg-success-bg text-success" },
  used: { label: "Used", className: "bg-surface text-text" },
  expired: { label: "Expired", className: "bg-surface text-text-muted" },
  revoked: { label: "Revoked", className: "bg-surface text-text-muted" },
};

export default async function LinksPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const user = await requireHost();
  const { done, error } = await searchParams;
  const now = new Date();
  const [links, eventTypes] = await Promise.all([store.listBookingLinks(user.id, now), store.listEventTypes(user.id)]);
  // One-off meetings aren't in the event types list; look their names up for the rows that need them.
  const names = new Map(eventTypes.map((et) => [et.id, et.name]));
  for (const id of new Set(links.map((l) => l.eventTypeId).filter((id) => !names.has(id)))) {
    const et = await store.getEventType(user.id, id);
    if (et) names.set(id, et.kind === "one_off" ? `${et.name} (one-off)` : et.name);
  }
  const tz = user.timezone;

  return (
    <div>
      <h1 className="font-display text-xl text-text">Links</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        A single-use link books one of your event types once. A one-off meeting offers a few times you pick, for one person.
      </p>
      {done === "revoked" && <p role="status" className="mt-4 rounded-md bg-surface p-3 text-sm text-text">Link revoked. It no longer works.</p>}
      {error === "not_revocable" && <p role="alert" className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">That link can&apos;t be revoked: it has been used, has expired, or isn&apos;t yours.</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-text">New single-use link</h2>
          <div className="mt-4"><SingleUseLinkForm eventTypes={eventTypes.filter((et) => et.active).map(({ id, name }) => ({ id, name }))} /></div>
        </Card>
        <Card>
          <h2 className="font-semibold text-text">New one-off meeting</h2>
          <p className="mt-2 text-text-muted">Pick up to 20 times outside your usual hours if you like. Your guest books one.</p>
          <Link href="/dashboard/links/new" className={`mt-4 ${buttonClasses({ variant: "secondary" })}`}>Set up a one-off meeting</Link>
        </Card>
      </div>

      <h2 className="mt-10 font-semibold text-text">Your links</h2>
      {links.length === 0 ? (
        <p className="mt-2 text-text-muted">No links yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {links.map((l) => (
            <li key={l.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text">
                    {names.get(l.eventTypeId) ?? "Event type removed"}
                    <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${STATE[l.state].className}`}>{STATE[l.state].label}</span>
                  </p>
                  {l.label && <p className="text-sm text-text">{l.label}</p>}
                  <p className="text-sm text-text-muted">
                    Made {formatDate(l.createdAt, tz)}
                    {l.usedBy && <> · booked by {l.usedBy.guestName} for {formatDate(l.usedBy.startAt, tz)}, <LocalTime date={l.usedBy.startAt} tz={tz} /></>}
                    {l.state === "open" && l.expiresAt && <> · expires {formatDate(l.expiresAt, tz)}</>}
                  </p>
                </div>
                {l.state === "open" && (
                  <form action={revokeLink}>
                    <input type="hidden" name="linkId" value={l.id} />
                    <Button type="submit" variant="ghost" size="sm">Revoke</Button>
                  </form>
                )}
                {l.usedBy && <Link href={`/dashboard/bookings/${l.usedBy.bookingId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">See booking</Link>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
