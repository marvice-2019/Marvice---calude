// "Add to calendar" for a booked session: links that open Google or Outlook with the event filled in. Apple Calendar and
// everything else take the .ics file from /b/<token>/calendar.ics.

export interface CalendarLinkEvent { title: string; details: string; location: string | null; start: Date; end: Date }

const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarLink(e: CalendarLinkEvent): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${compact(e.start)}/${compact(e.end)}`, details: e.details });
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Outlook on the web (personal accounts; work accounts are sent on to their own Outlook). */
export function outlookCalendarLink(e: CalendarLinkEvent): string {
  const q = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: e.title, body: e.details,
    startdt: e.start.toISOString(), enddt: e.end.toISOString(),
  });
  if (e.location) q.set("location", e.location);
  return `https://outlook.live.com/calendar/0/action/compose?${q}`;
}

/** The address guests are sent to after booking: https only, so a host can't point it at a script or a local file. */
export function cleanRedirectUrl(raw: string): string | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && v.length <= 500 ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
