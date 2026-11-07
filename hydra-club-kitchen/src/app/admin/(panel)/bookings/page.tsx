import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { can } from "@/auth/roles";
import { adminListBookings, BOOKING_STATUSES } from "@/booking/service";
import { serviceDateOf, slotsFor } from "@/booking/time";
import { BookingActions } from "@/components/admin/client";
import { WalkInForm } from "@/components/admin/forms";
import { getDb } from "@/db";
import { FLOOR } from "@/content/floor-plan";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const ZONES = [
  ["", "All zones"],
  ["standard", "Standard"],
  ["vip", "VIP"],
  ["vvip", "VVIP"],
  ["mezz", "Mezzanine"],
] as const;

/** §8 Bookings: filter by night/status/zone, act on each, add walk-ins, export CSV. */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("bookings:read");
  const q = await searchParams;
  const db = getDb();
  const filters = { date: q.date || undefined, status: q.status || undefined, zone: q.zone || undefined };
  const [result, settings] = await Promise.all([adminListBookings(db, filters), getSettings(db)]);
  const tonight = serviceDateOf(new Date());
  const date = result.ok ? result.date : tonight;
  const now = new Date();
  const slots = slotsFor(settings.hours, tonight, settings.slot_length_minutes)
    .filter((s) => s.endsAt > now)
    .map((s) => s.time);

  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Bookings</h1>
      <form className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" method="get">
        <label className="grid gap-1 text-sm text-muted">
          Night
          <input className="admin-input" type="date" name="date" defaultValue={date} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Status
          <select className="admin-input" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", "-")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Zone
          <select className="admin-input" name="zone" defaultValue={filters.zone ?? ""}>
            {ZONES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="admin-btn self-end">
          Show
        </button>
      </form>

      {!result.ok ? (
        <p className="mt-6 text-[#ff8a8a]">{result.message}</p>
      ) : result.bookings.length === 0 ? (
        <p className="mt-6 text-muted">No bookings for this filter.</p>
      ) : (
        <ul className="mt-6 grid gap-2">
          {result.bookings.map((b) => (
            <li key={b.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {b.time} · {b.table} · {b.name} · {b.guests} pax
                </p>
                <p className="text-xs text-muted">
                  {b.status.replace("_", "-")} · {b.ref} · {b.source === "walk_in" ? "walk-in" : b.source}
                </p>
              </div>
              {b.phone && (
                <a href={`tel:${b.phone}`} className="inline-flex min-h-11 items-center text-sm text-aqua underline underline-offset-4">
                  {b.phone}
                </a>
              )}
              {b.notes && <p className="text-sm text-muted">“{b.notes}”</p>}
              {can(user.role, "bookings:write") && (
                <div className="mt-2">
                  <BookingActions id={b.id} status={b.status} label={`${b.ref} ${b.name}`} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {can(user.role, "bookings:write") && (
        <div className="mt-8">
          <WalkInForm tables={FLOOR.tables.map((t) => t.code)} slots={slots} />
        </div>
      )}

      {can(user.role, "bookings:export") && (
        <form className="mt-8 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3" method="get" action="/api/admin/bookings/export">
          <h2 className="text-lg font-semibold sm:col-span-3">Export to CSV</h2>
          <label className="grid gap-1 text-sm text-muted">
            From
            <input className="admin-input" type="date" name="from" required defaultValue={date} />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            To
            <input className="admin-input" type="date" name="to" required defaultValue={date} />
          </label>
          <button type="submit" className="admin-btn col-span-2 self-end sm:col-span-1">
            Download CSV
          </button>
        </form>
      )}
    </>
  );
}
