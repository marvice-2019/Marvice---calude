// India's gazetted holidays for central government offices, from the Department of Personnel and Training orders:
// 2026: O.M. F.No.12/2/2023-JCA dated 3 July 2025; 2027: O.M. F.No.12/2/2023-JCA dated 16 July 2026 (Annexure I).
// Dates of Id-ul-Fitr, Bakrid, Muharram and Milad-un-Nabi depend on the moon and can shift by a day; hosts see every date
// before blocking it. Regional festivals (Pongal, Onam, Ugadi…) differ by state, so hosts add those with "Block a day".

export interface Holiday { date: string; name: string; lunar?: boolean }

export const GAZETTED_HOLIDAYS: readonly Holiday[] = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-04", name: "Holi" },
  { date: "2026-03-21", name: "Id-ul-Fitr", lunar: true },
  { date: "2026-03-26", name: "Ram Navami" },
  { date: "2026-03-31", name: "Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-01", name: "Buddha Purnima" },
  { date: "2026-05-27", name: "Id-ul-Zuha (Bakrid)", lunar: true },
  { date: "2026-06-26", name: "Muharram", lunar: true },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-26", name: "Milad-un-Nabi", lunar: true },
  { date: "2026-09-04", name: "Janmashtami" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-08", name: "Diwali (Deepavali)" },
  { date: "2026-11-24", name: "Guru Nanak's Birthday" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-03-10", name: "Id-ul-Fitr", lunar: true },
  { date: "2027-03-23", name: "Holi" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-04-15", name: "Ram Navami" },
  { date: "2027-04-19", name: "Mahavir Jayanti" },
  { date: "2027-05-17", name: "Id-ul-Zuha (Bakrid)", lunar: true },
  { date: "2027-05-20", name: "Buddha Purnima" },
  { date: "2027-06-16", name: "Muharram", lunar: true },
  { date: "2027-08-15", name: "Independence Day and Milad-un-Nabi" },
  { date: "2027-08-25", name: "Janmashtami" },
  { date: "2027-10-02", name: "Gandhi Jayanti" },
  { date: "2027-10-09", name: "Dussehra" },
  { date: "2027-10-29", name: "Diwali (Deepavali)" },
  { date: "2027-11-14", name: "Guru Nanak's Birthday" },
  { date: "2027-12-25", name: "Christmas Day" },
];

/** The holidays from `today` (YYYY-MM-DD, the host's local date) up to a year ahead, soonest first. */
export function upcomingHolidays(today: string, list: readonly Holiday[] = GAZETTED_HOLIDAYS): Holiday[] {
  const [y, m, d] = today.split("-").map(Number);
  const yearAhead = `${String(y + 1).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return list.filter((h) => h.date >= today && h.date <= yearAhead).sort((a, b) => a.date.localeCompare(b.date));
}

/** Which of `picked` are real upcoming holiday dates: anything else from the form is ignored, never blocked. */
export function pickHolidayDates(picked: string[], today: string): string[] {
  const allowed = new Set(upcomingHolidays(today).map((h) => h.date));
  return [...new Set(picked.filter((d) => allowed.has(d)))].sort();
}
