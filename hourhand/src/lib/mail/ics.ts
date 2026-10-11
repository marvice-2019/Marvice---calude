// A minimal iCalendar file (RFC 5545) so a guest can add a booking to their calendar from the confirmation email.
// METHOD:PUBLISH on purpose: a proper invite (REQUEST/CANCEL with an organizer) comes from the host's own calendar in B4.

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string | null;
  url: string;
  stamp: Date;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapes TEXT values: backslash, semicolon, comma and line breaks. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to at most 75 octets per line, never splitting a multi-byte character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hourhand//Bookings//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`, `DTSTAMP:${utc(e.stamp)}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `URL:${e.url}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
