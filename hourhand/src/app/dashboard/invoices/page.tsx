import Link from "next/link";
import { TaxProfileForm } from "@/components/TaxProfileForm";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { formatDate } from "@/lib/format";
import { getTaxProfile, listInvoices } from "@/lib/gst/invoices";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const user = await requireUser();
  const db = authEnabled() ? getPool(process.env.DATABASE_URL as string) : null;
  const [profile, invoices] = db ? await Promise.all([getTaxProfile(db, user.id), listInvoices(db, user.id)]) : [null, []];
  const month = new Date().toISOString().slice(0, 7);

  return (
    <div>
      <h1 className="font-display text-xl text-text">GST invoices</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        If you&apos;re registered for GST, add your details and every guest who pays you (a booking or a package) gets a tax invoice by email.
        A refund issues a credit note. Prices are taken as including GST. Deposits aren&apos;t invoiced.
      </p>
      <Card className="mt-6 max-w-xl"><h2 className="mb-4 font-semibold text-text">Your GST details</h2><TaxProfileForm saved={profile} /></Card>
      <p className="mt-3 max-w-xl text-sm text-text-muted">
        Check your SAC code and rate with your CA. Place of supply is your registered state, since Hourhand doesn&apos;t collect guests&apos; addresses.
      </p>

      <section aria-labelledby="inv-list" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="inv-list" className="font-semibold text-text">Issued</h2>
          {invoices.length > 0 && (
            <form action="/dashboard/invoices/export" className="flex items-center gap-2">
              <label htmlFor="inv-month" className="text-sm text-text-muted">Month</label>
              <input id="inv-month" type="month" name="month" defaultValue={month} className="h-11 rounded-md border border-border-input bg-card px-2 text-text" />
              <button type="submit" className="inline-flex min-h-11 items-center font-semibold text-accent underline">Download CSV</button>
            </form>
          )}
        </div>
        {invoices.length === 0 ? <p className="mt-2 text-text-muted">None yet.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full max-w-3xl text-left text-sm">
              <thead><tr className="text-text-muted"><th className="py-2 pr-4 font-medium">Number</th><th className="py-2 pr-4 font-medium">Date</th><th className="py-2 pr-4 font-medium">Buyer</th><th className="py-2 font-medium">Total</th></tr></thead>
              <tbody>
                {invoices.map((v) => (
                  <tr key={v.id} className="border-t border-border text-text">
                    <td className="py-2 pr-4"><Link href={`/invoice/${v.token}`} className="font-semibold text-accent underline">{v.number}</Link>{v.kind === "credit_note" && <span className="ml-2 text-text-muted">credit note</span>}</td>
                    <td className="py-2 pr-4">{formatDate(v.issuedAt, user.timezone)}</td>
                    <td className="py-2 pr-4">{v.buyerName}</td>
                    <td className="py-2">{v.kind === "credit_note" ? "−" : ""}{formatMoney(v.totalMinor, "INR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
