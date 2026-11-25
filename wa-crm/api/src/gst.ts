// GST at 18% on SaaS subscriptions (SAC 998314 — confirm with your CA).
// Same state as the supplier: CGST 9% + SGST 9%. Different state: IGST 18%.
// All amounts are integer paise; the parts always add up exactly.

export interface GstSplit {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  placeOfSupply: string;
}

const RATE = 18;

function split(taxablePaise: number, gstPaise: number, supplierState: string, customerState: string | null): GstSplit {
  // Unknown customer state: treated as intra-state (place of supply = supplier). Flag for CA review.
  const pos = customerState ?? supplierState;
  if (pos === supplierState) {
    const cgst = Math.floor(gstPaise / 2);
    return { taxablePaise, cgstPaise: cgst, sgstPaise: gstPaise - cgst, igstPaise: 0,
      totalPaise: taxablePaise + gstPaise, placeOfSupply: pos };
  }
  return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise,
    totalPaise: taxablePaise + gstPaise, placeOfSupply: pos };
}

/** GST on a price quoted before tax. */
export function computeGst(taxablePaise: number, supplierState: string, customerState: string | null): GstSplit {
  assertPaise(taxablePaise);
  return split(taxablePaise, Math.round((taxablePaise * RATE) / 100), supplierState, customerState);
}

/** Splits an amount that already includes GST (what Razorpay charges) into taxable value and tax. */
export function splitInclusive(totalPaise: number, supplierState: string, customerState: string | null): GstSplit {
  assertPaise(totalPaise);
  const taxable = Math.round((totalPaise * 100) / (100 + RATE));
  return split(taxable, totalPaise - taxable, supplierState, customerState);
}

/** Indian financial year label for a date, e.g. 2026-05-01 → "2026-27", 2027-03-31 → "2026-27". */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function assertPaise(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('amount must be a non-negative integer number of paise');
}
