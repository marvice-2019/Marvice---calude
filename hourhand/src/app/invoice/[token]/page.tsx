import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { authEnabled } from "@/lib/auth/auth";
import { formatMoney } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { formatDate } from "@/lib/format";
import { invoiceByToken, stateLabel } from "@/lib/gst/invoices";

export const dynamic = "force-dynamic";

/**
 * A GST tax invoice or credit note, by its private link. Laid out with the particulars CGST Rule 46 asks for; electronic,
 * so no signature (Rule 46 proviso for invoices under the IT Act). Prints cleanly to paper or PDF.
 */
export default async function InvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = authEnabled() ? await invoiceByToken(getPool(process.env.DATABASE_URL as string), token) : null;
  if (!v) notFound();
  const note = v.kind === "credit_note";
  const money = (m: number) => formatMoney(m, "INR");
  const rate = v.rateBp / 100;
  const intra = v.igstMinor === 0;
  const row = (label: string, value: string, strong = false) => (
    <tr className="border-t border-border"><td className="py-2 pr-4 text-text-muted">{label}</td><td className={`py-2 text-right ${strong ? "font-semibold text-text" : "text-text"}`}>{value}</td></tr>
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 print:py-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl text-text">{note ? "Credit note" : "Tax invoice"}</h1>
          <p className="mt-1 text-text">{v.number}</p>
          {note && <p className="text-sm text-text-muted">Against invoice {v.originalNumber}</p>}
        </div>
        <PrintButton />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section aria-label="Supplier">
          <h2 className="text-sm font-semibold text-text-muted">From</h2>
          <p className="mt-1 font-semibold text-text">{v.supplier.legalName}</p>
          <p className="whitespace-pre-line text-text">{v.supplier.address}</p>
          <p className="text-text">GSTIN {v.supplier.gstin}</p>
          <p className="text-text">State {stateLabel(v.supplier.stateCode)}</p>
        </section>
        <section aria-label="Recipient">
          <h2 className="text-sm font-semibold text-text-muted">To</h2>
          <p className="mt-1 font-semibold text-text">{v.buyerName}</p>
          <p className="text-text">{v.buyerEmail}</p>
          <p className="text-text">Unregistered</p>
        </section>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-text-muted">Date of issue</dt><dd className="text-text">{formatDate(v.issuedAt, "Asia/Kolkata")}</dd></div>
        <div><dt className="text-text-muted">Place of supply</dt><dd className="text-text">{stateLabel(v.placeOfSupply)}</dd></div>
        <div><dt className="text-text-muted">Reverse charge</dt><dd className="text-text">No</dd></div>
      </dl>

      <table className="mt-6 w-full text-left text-sm">
        <thead><tr className="text-text-muted"><th className="py-2 pr-4 font-medium">Description</th><th className="py-2 pr-4 font-medium">SAC</th><th className="py-2 pr-4 font-medium">Qty</th><th className="py-2 text-right font-medium">Taxable value</th></tr></thead>
        <tbody>
          <tr className="border-t border-border text-text"><td className="py-2 pr-4">{v.description}</td><td className="py-2 pr-4">{v.sac}</td><td className="py-2 pr-4">1</td><td className="py-2 text-right">{money(v.taxableMinor)}</td></tr>
        </tbody>
      </table>
      <table className="ml-auto mt-4 w-full max-w-xs text-sm">
        <tbody>
          {row("Taxable value", money(v.taxableMinor))}
          {intra ? <>{row(`CGST ${rate / 2}%`, money(v.cgstMinor))}{row(`SGST ${rate / 2}%`, money(v.sgstMinor))}</> : row(`IGST ${rate}%`, money(v.igstMinor))}
          {row(note ? "Total refunded" : "Total paid", money(v.totalMinor), true)}
        </tbody>
      </table>
      <p className="mt-8 text-sm text-text-muted">Computer-generated {note ? "credit note" : "invoice"}; no signature required. Issued through Hourhand for {v.supplier.legalName}.</p>
    </main>
  );
}
