import type { Metadata } from "next";
import { getTodayView } from "@/admin/today";
import { requireUser } from "@/auth/guard";
import { AutoRefresh, BookingActions } from "@/components/admin/client";
import { getDb } from "@/db";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const STATE_STYLE = {
  free: "border-line text-muted",
  booked: "border-blue/60 text-text",
  seated: "border-aqua bg-aqua/15 text-text",
  held: "border-amber/60 bg-amber/10 text-amber",
} as const;

const hourLabel = (h: string) => {
  const n = Number(h.slice(0, 2));
  return `${((n + 11) % 12) + 1} ${n < 12 ? "AM" : "PM"}`;
};

/** §8 Today: tonight's arrivals by hour and every table's state right now. Refreshes every minute. */
export default async function TodayPage() {
  await requireUser("bookings:read");
  const view = await getTodayView(getDb());
  const night = new Date(`${view.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <>
      <AutoRefresh seconds={60} />
      <h1 className="font-display text-3xl tracking-[-0.04em]">Tonight</h1>
      <p className="text-muted">{night}</p>

      <dl className="mt-5 grid grid-cols-3 gap-3">
        {[
          ["Bookings", view.counts.bookings],
          ["Covers", view.counts.covers],
          ["Seated now", view.counts.seatedNow],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-display text-2xl tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="tables-now" className="mt-8">
        <h2 id="tables-now" className="text-lg font-semibold">
          Tables now
        </h2>
        <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
          {view.tables.map((t) => (
            <li key={t.code} className={`rounded-lg border p-2 text-center text-sm ${STATE_STYLE[t.state]}`}>
              <span className="block font-semibold">{t.code}</span>
              <span className="block text-[11px]">{t.state === "booked" ? `from ${t.next}` : t.state}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="arrivals" className="mt-8">
        <h2 id="arrivals" className="text-lg font-semibold">
          Arrivals
        </h2>
        {view.hours.length === 0 ? (
          <p className="mt-3 text-muted">No bookings yet tonight.</p>
        ) : (
          view.hours.map((h) => (
            <div key={h.hour} className="mt-4">
              <h3 className="text-sm tracking-wide text-muted uppercase">{hourLabel(h.hour)}</h3>
              <ul className="mt-2 grid gap-2">
                {h.arrivals.map((a) => (
                  <li key={a.id} className={`rounded-xl border border-line bg-surface p-3 ${a.status === "cancelled" || a.status === "no_show" ? "opacity-50" : ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">
                        {a.time} · {a.table} · {a.name} · {a.guests} pax
                      </p>
                      <p className="text-xs text-muted">
                        {a.status.replace("_", "-")} · {a.ref}
                        {a.source === "walk_in" ? " · walk-in" : ""}
                      </p>
                    </div>
                    {a.phone && (
                      <a href={`tel:${a.phone}`} className="mt-1 inline-flex min-h-11 items-center text-sm text-aqua underline underline-offset-4">
                        {a.phone}
                      </a>
                    )}
                    {a.notes && <p className="mt-1 text-sm text-muted">“{a.notes}”</p>}
                    <div className="mt-2">
                      <BookingActions id={a.id} status={a.status} label={`${a.ref} ${a.name}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
