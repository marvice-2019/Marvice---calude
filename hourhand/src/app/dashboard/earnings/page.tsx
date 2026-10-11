import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { requireOwnAccount } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { monthlyEarnings, monthOf, monthRange } from "@/lib/earnings";

export const dynamic = "force-dynamic";

const label = (month: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const shift = (month: string, by: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7); };

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireOwnAccount();
  const now = new Date();
  const current = monthOf(now);
  const asked = (await searchParams).month;
  const month = asked && monthRange(asked) && asked <= current ? asked : current;
  const e = authEnabled() ? await monthlyEarnings(getPool(process.env.DATABASE_URL as string), user.id, month, now) : null;
  const money = (m: number) => formatMoney(m, "INR");
  const tile = (title: string, value: string, hint?: string) => (
    <Card><p className="text-sm text-text-muted">{title}</p><p className="mt-1 text-xl font-semibold text-text">{value}</p>{hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}</Card>
  );
  return (
    <div>
      <h1 className="font-display text-xl text-text">Earnings</h1>
      <nav aria-label="Month" className="mt-3 flex flex-wrap items-center gap-4">
        <Link href={`/dashboard/earnings?month=${shift(month, -1)}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">‹ {label(shift(month, -1))}</Link>
        <span className="font-semibold text-text">{label(month)}</span>
        {month < current && <Link href={`/dashboard/earnings?month=${shift(month, 1)}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">{label(shift(month, 1))} ›</Link>}
      </nav>
      {!e ? <p className="mt-6 text-text-muted">Earnings need payments, which this demo copy doesn&apos;t have.</p> : (
        <>
          <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
            {tile("Net received", money(e.netMinor), "Bookings + packages + kept deposits − refunds")}
            {tile("Bookings", money(e.bookingsMinor))}
            {tile("Packages", money(e.packagesMinor))}
            {tile("Refunds", money(e.refundsMinor))}
            {tile("Deposits kept", money(e.depositsKeptMinor), "From no-shows")}
            {tile("GST in that", money(e.gstMinor), "From your invoices; owed to the government")}
          </div>
          <p className="mt-3 max-w-3xl text-sm text-text-muted">
            Razorpay&apos;s fee is about {money(e.feeEstimateMinor)} at their standard 2% + GST; your settlement report has the exact figure.
            {e.depositsHeldMinor > 0 && ` ${money(e.depositsHeldMinor)} in deposits is held until those sessions are done.`}
          </p>

          <section aria-labelledby="sessions" className="mt-8">
            <h2 id="sessions" className="font-semibold text-text">Sessions</h2>
            <dl className="mt-2 flex flex-wrap gap-6">
              <div><dt className="text-sm text-text-muted">Held</dt><dd className="text-lg font-semibold text-text">{e.sessions.held}</dd></div>
              <div><dt className="text-sm text-text-muted">Coming up</dt><dd className="text-lg font-semibold text-text">{e.sessions.upcoming}</dd></div>
              <div><dt className="text-sm text-text-muted">No-shows</dt><dd className="text-lg font-semibold text-text">{e.sessions.noShows}</dd></div>
              <div><dt className="text-sm text-text-muted">Cancelled by guests</dt><dd className="text-lg font-semibold text-text">{e.sessions.cancelledByGuest}</dd></div>
              <div><dt className="text-sm text-text-muted">Cancelled by you</dt><dd className="text-lg font-semibold text-text">{e.sessions.cancelledByHost}</dd></div>
            </dl>
          </section>

          {e.byEventType.length > 0 && (
            <section aria-labelledby="by-type" className="mt-8">
              <h2 id="by-type" className="font-semibold text-text">By event type</h2>
              <table className="mt-2 w-full max-w-xl text-left text-sm">
                <thead><tr className="text-text-muted"><th className="py-2 pr-4 font-medium">Event type</th><th className="py-2 pr-4 font-medium">Bookings</th><th className="py-2 font-medium">Packages</th></tr></thead>
                <tbody>
                  {e.byEventType.map((l) => (
                    <tr key={l.eventTypeId} className="border-t border-border text-text"><td className="py-2 pr-4">{l.eventName}</td><td className="py-2 pr-4">{money(l.bookingsMinor)}</td><td className="py-2">{money(l.packagesMinor)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <a href={`/dashboard/earnings/export?month=${month}`} className="mt-8 inline-flex min-h-11 items-center font-semibold text-accent underline">Download {label(month)} as CSV</a>
        </>
      )}
    </div>
  );
}
