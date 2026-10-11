// GST arithmetic and identifiers for host invoices (India). Pure functions only; checked against CGST Rule 46 and the
// IGST Act section 12. Prices on Hourhand are GST-inclusive: the invoice splits what the guest paid into taxable value and tax.

/** State and UT codes as used in GSTINs (first two digits). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh",
  "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh",
};

/** The GST rates a host can pick, in basis points (18% = 1800). */
export const GST_RATES_BP = [500, 1200, 1800, 2800] as const;

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN check character: the standard mod-36 scheme over the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** A well-formed GSTIN: state code, PAN, entity number, "Z", check character, and a known state. */
export function isValidGstin(raw: string): boolean {
  const g = raw.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  if (!(g.slice(0, 2) in GST_STATES)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** The Indian financial year an instant falls in, as "2627" for April 2026 to March 2027 (IST). */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "HH/2627/000123": prefix, financial year, serial. Rule 46(b): at most 16 characters, letters, digits, "-" and "/". */
export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  const n = `${prefix}/${fy}/${String(seq).padStart(6, "0")}`;
  if (n.length > 16 || !/^[A-Za-z0-9/-]+$/.test(n)) throw new Error(`Invoice number ${n} breaks the 16-character rule`);
  return n;
}

export interface TaxSplit { totalMinor: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number }

/**
 * Splits a GST-inclusive amount. Within one state the tax is half CGST, half SGST (any odd paisa goes to SGST); across
 * states it is all IGST. The parts always add back up to the amount paid.
 */
export function splitInclusive(totalMinor: number, rateBp: number, interState: boolean): TaxSplit {
  const taxableMinor = Math.round((totalMinor * 10_000) / (10_000 + rateBp));
  const tax = totalMinor - taxableMinor;
  if (interState) return { totalMinor, taxableMinor, cgstMinor: 0, sgstMinor: 0, igstMinor: tax };
  const cgstMinor = Math.floor(tax / 2);
  return { totalMinor, taxableMinor, cgstMinor, sgstMinor: tax - cgstMinor, igstMinor: 0 };
}

/**
 * Place of supply for a service to an unregistered guest (IGST Act s.12(2)(b)): the guest's state when their address is
 * on record, otherwise the supplier's. Hourhand records only name and email, so this is the host's state. Kept as a
 * function so recording a guest's state later changes one place.
 */
export function placeOfSupply(supplierState: string, guestState: string | null): string {
  return guestState && guestState in GST_STATES ? guestState : supplierState;
}
