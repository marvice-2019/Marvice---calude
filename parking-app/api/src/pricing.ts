// Single source of truth for prices. All amounts in paise, integer math.
// SPEC §6: started hours (min 1); per 24 h block min(hours × rate, 8 × rate);
// promo off parking before GST; platform fee never discounted; GST 18% to the paise.

export const GST_BPS = 1800;
export const DAILY_CAP_HOURS = 8;

export type Promo = { code: string; percentOff: number; maxOffPaise: number };
export type Quote = {
  hours: number; ratePaise: number; basePaise: number; discountPaise: number;
  feePaise: number; gstPaise: number; totalPaise: number; promoCode: string | null;
};

export function startedHours(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 3_600_000));
}

export function gstOn(paise: number): number {
  return Math.round((paise * GST_BPS) / 10_000);
}

export function quote(ratePaise: number, from: Date, to: Date, feePaise: number, promo?: Promo | null, dailyCapPaise?: number | null): Quote {
  const hours = startedHours(from, to);
  const cap = dailyCapPaise ?? ratePaise * DAILY_CAP_HOURS;
  let basePaise = 0;
  for (let left = hours; left > 0; left -= 24) basePaise += Math.min(Math.min(left, 24) * ratePaise, cap);
  const discountPaise = promo ? Math.min(Math.round((basePaise * promo.percentOff) / 100), promo.maxOffPaise) : 0;
  const gstPaise = gstOn(basePaise - discountPaise + feePaise);
  return { hours, ratePaise, basePaise, discountPaise, feePaise, gstPaise,
    totalPaise: basePaise - discountPaise + feePaise + gstPaise, promoCode: promo?.code ?? null };
}

/** Day of week (0 = Sunday) in India time, regardless of server time zone. */
export function istWeekday(d: Date): number {
  return new Date(d.getTime() + 330 * 60_000).getUTCDay();
}

/** Indian financial year label for invoices, e.g. 2026-27. */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
