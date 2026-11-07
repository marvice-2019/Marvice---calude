/** Minimal RFC 5545 calendar file for a booking (add-to-calendar on the confirmation screen). */
export function bookingIcs(b: {
  ref: string;
  table: string;
  guests: number;
  startsAt: Date;
  endsAt: Date;
  address: string;
  siteHost: string;
}): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hydra Club & Kitchen//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.ref}@${b.siteHost}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(b.startsAt)}`,
    `DTEND:${stamp(b.endsAt)}`,
    `SUMMARY:${esc(`Hydra Club & Kitchen · Table ${b.table}`)}`,
    `DESCRIPTION:${esc(`Booking ${b.ref} for ${b.guests}. Show this reference at the door.`)}`,
    ...(b.address ? [`LOCATION:${esc(b.address)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
