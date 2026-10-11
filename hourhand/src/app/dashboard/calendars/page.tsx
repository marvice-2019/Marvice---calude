import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { calendarDeps } from "@/lib/calendar/env";
import { store, type CalendarConnection } from "@/lib/data";
import { SYNC_STALE_AFTER_MINUTES } from "@/lib/slots";
import { disconnectCalendar, toggleConflictCheck, useForBookings } from "./actions";

// The connect links never prefetch: a prefetch would start a Google handshake nobody asked for.
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  denied: "Google didn't connect: the request was cancelled. Try again when you're ready.",
  missing_permissions: "Hourhand needs every permission on Google's screen to check your availability and add bookings. Connect again and leave them all ticked.",
  state_mismatch: "That connection link didn't match this browser. Start again from this page.",
  expired: "That took longer than 10 minutes. Start again from this page.",
  wrong_user: "You signed in as someone else partway through. Start again from this page.",
  google: "Google didn't respond as expected. Try again in a minute.",
  not_configured: "Google Calendar isn't set up on this server yet.",
  demo: "The demo data can't connect a real calendar. Sign in with the database set up to connect one.",
  calendar_limit: "The Free plan checks 2 calendars for conflicts. Stop checking one first, or move to Solo for unlimited calendars.",
};

function health(c: CalendarConnection, now: Date): { tone: string; words: string } {
  if (c.status === "disconnected") return { tone: "bg-danger-bg text-danger", words: "Disconnected. Bookings paused until you reconnect" };
  if (!c.lastSyncedAt) return { tone: "bg-warning-bg text-warning", words: "First sync in progress" };
  const minutes = Math.floor((now.getTime() - c.lastSyncedAt.getTime()) / 60_000);
  if (c.status === "degraded" || minutes > SYNC_STALE_AFTER_MINUTES) {
    return { tone: "bg-warning-bg text-warning", words: minutes > SYNC_STALE_AFTER_MINUTES ? "Not syncing. Bookings paused, retrying" : "Sync slow, retrying" };
  }
  return { tone: "bg-success-bg text-success", words: `In sync · checked ${minutes} min ago` };
}

export default async function CalendarsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [connections, calendars] = await Promise.all([store.listCalendarConnections(user.id), store.listCalendars(user.id)]);
  const canConnect = authEnabled() && calendarDeps() !== null;
  const live = authEnabled();
  const now = new Date();

  return (
    <div>
      <h1 className="font-display text-xl text-text">Calendars</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        Hourhand checks these calendars so nobody books you when you&apos;re busy, and adds each booking to the one you choose.
      </p>

      {params.connected && <p role="status" className="mt-4 text-success">Google Calendar connected. Your busy times are syncing now.</p>}
      {params.error && <p role="alert" className="mt-4 max-w-xl text-danger">{MESSAGES[params.error] ?? MESSAGES.google}</p>}

      <div className="mt-6 grid max-w-2xl gap-4">
        {connections.length === 0 && (
          <Card>
            <h2 className="font-semibold text-text">No calendar connected</h2>
            <p className="mt-1 text-text-muted">Without one, Hourhand only knows your working hours and the bookings it made itself.</p>
          </Card>
        )}
        {connections.map((c) => {
          const h = health(c, now);
          const own = calendars.filter((cal) => cal.connectionId === c.id);
          return (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-text">Google · {c.accountEmail}</h2>
                  <span className={`mt-1 inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs ${h.tone}`}>
                    <span aria-hidden className="size-2 rounded-pill bg-current" />
                    {h.words}
                  </span>
                  {c.lastError && c.status !== "ok" && <p className="mt-1 text-sm text-text-muted">Last error: {c.lastError.slice(0, 160)}</p>}
                </div>
                {live && (
                  <form action={disconnectCalendar}>
                    <input type="hidden" name="connectionId" value={c.id} />
                    <Button type="submit" variant="secondary" size="sm">Disconnect</Button>
                  </form>
                )}
              </div>
              {c.status === "disconnected" && canConnect && (
                <Link prefetch={false} href="/api/calendars/google/connect" className={`${buttonClasses()} mt-4`}>Reconnect Google Calendar</Link>
              )}
              <ul className="mt-4 divide-y divide-border">
                {own.map((cal) => (
                  <li key={cal.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-text">{cal.name}</p>
                      <p className="text-sm text-text-muted">
                        {cal.checkConflicts ? "Checked for conflicts" : "Not checked"}
                        {cal.isAddTo ? " · New bookings go here" : ""}
                      </p>
                    </div>
                    {live && (
                      <div className="flex flex-wrap gap-2">
                        <form action={toggleConflictCheck}>
                          <input type="hidden" name="calendarId" value={cal.id} />
                          <input type="hidden" name="on" value={cal.checkConflicts ? "0" : "1"} />
                          <Button type="submit" variant="ghost" size="sm" aria-label={`${cal.checkConflicts ? "Stop checking" : "Check"} ${cal.name} for conflicts`}>
                            {cal.checkConflicts ? "Stop checking" : "Check for conflicts"}
                          </Button>
                        </form>
                        {cal.canWrite && !cal.isAddTo && (
                          <form action={useForBookings}>
                            <input type="hidden" name="calendarId" value={cal.id} />
                            <Button type="submit" variant="ghost" size="sm" aria-label={`Add new bookings to ${cal.name}`}>Add bookings here</Button>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {canConnect ? (
        <Link prefetch={false} href="/api/calendars/google/connect" className={`${buttonClasses()} mt-6`}>
          {connections.length ? "Connect another Google account" : "Connect Google Calendar"}
        </Link>
      ) : (
        <p className="mt-6 max-w-xl text-sm text-text-muted">{live ? MESSAGES.not_configured : MESSAGES.demo}</p>
      )}
    </div>
  );
}
