// iCloud calendars over CalDAV. Apple has no OAuth for calendars: the host gives their Apple ID and an app-specific
// password, which goes in the `credential` argument ("appleId:password") of every call. The password must never reach
// a log line or an error message, so errors here only ever name a method, a path and a status.

import { TZDate } from "@date-fns/tz";
import { CalendarApiError, type BusyRange, type CalendarEntry, type EventInput, type EventResult } from "./provider";

export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";

type Fetch = typeof fetch;

/** The server's answer as one href plus the properties found under it, local names only (namespaces don't vary in practice). */
interface DavResponse { href: string; props: string }

/** Only icloud.com hosts over https (or the configured base, for tests) ever receive the credential. */
function allowedUrl(raw: string, base: URL): URL {
  let u: URL;
  try { u = new URL(raw, base); } catch { throw new CalendarApiError("iCloud returned an unreadable address", { retryable: false }); }
  const host = u.hostname.toLowerCase();
  const icloud = u.protocol === "https:" && (host === "icloud.com" || host.endsWith(".icloud.com"));
  if (!icloud && u.origin !== base.origin) throw new CalendarApiError(`iCloud pointed outside icloud.com (${u.protocol}//${host})`, { retryable: false });
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The five predefined XML entities and numeric ones; DTDs are refused outright, so no other entity can exist (no XXE). */
function xmlText(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;"))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m));
}

/** Every element with this local name (any prefix): its inner XML. Enough for the few flat properties CalDAV returns. */
function elements(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] ?? "");
}

function parseMultistatus(xml: string): DavResponse[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new CalendarApiError("iCloud returned XML with a DTD", { retryable: false });
  return elements(xml, "response").map((r) => ({ href: xmlText(elements(r, "href")[0] ?? "").trim(), props: r }));
}

/** The text of the first `href` inside the named property, or null. */
const hrefIn = (props: string, prop: string) => {
  const p = elements(props, prop)[0];
  const h = p === undefined ? undefined : elements(p, "href")[0];
  return h === undefined ? null : xmlText(h).trim();
};

// --- iCalendar -------------------------------------------------------------------------------------------------

interface Prop { value: string; params: Record<string, string> }
type VEvent = Map<string, Prop>;

function parseVEvents(ics: string): VEvent[] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: VEvent[] = [];
  let cur: VEvent | null = null;
  let depth = 0; // VALARMs inside a VEVENT carry their own TRIGGER/DURATION, which must not be read as the event's
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = new Map(); depth = 0; continue; }
    if (!cur) continue;
    if (line === "END:VEVENT") { out.push(cur); cur = null; continue; }
    if (line.startsWith("BEGIN:")) { depth++; continue; }
    if (line.startsWith("END:")) { depth--; continue; }
    if (depth > 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(";");
    cur.set(name.toUpperCase(), {
      value: line.slice(colon + 1),
      params: Object.fromEntries(params.map((p) => { const i = p.indexOf("="); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, "")]; })),
    });
  }
  return out;
}

/** A DATE-TIME (UTC, TZID'd or floating) or a DATE; DATEs and floating times are placed in `zone`, the host's. */
function icsTime(p: Prop, zone: string): { at: Date; date: boolean } {
  const m = p.value.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/);
  if (!m) throw new CalendarApiError("iCloud returned an unreadable event time", { retryable: false });
  const [y, mo, d, h = "0", mi = "0", s = "0"] = m.slice(1, 7);
  const n = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  if (m[7]) return { at: new Date(Date.UTC(...n)), date: false };
  const tz = (!m[4] ? null : p.params.TZID) || zone;
  let at: Date;
  try { at = new Date(new TZDate(...n, tz).getTime()); } catch { at = new Date(new TZDate(...n, zone).getTime()); }
  if (Number.isNaN(at.getTime())) at = new Date(new TZDate(...n, zone).getTime()); // an unknown TZID name: the host's zone is the best guess
  return { at, date: !m[4] };
}

/** RFC 5545 DURATION, e.g. "PT1H30M", "P1D", "P1W". Days count as whole host days for all-day events. */
function addDuration(start: Date, dur: string, zone: string): Date {
  const m = dur.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) throw new CalendarApiError("iCloud returned an unreadable event duration", { retryable: false });
  const sign = m[1] === "-" ? -1 : 1;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x ?? 0));
  const day = new TZDate(start.getTime(), zone);
  const shifted = new TZDate(day.getFullYear(), day.getMonth(), day.getDate() + sign * (w * 7 + d), day.getHours(), day.getMinutes(), day.getSeconds(), zone);
  return new Date(shifted.getTime() + sign * ((h * 60 + mi) * 60 + s) * 1000);
}

/** Busy ranges in an expanded calendar-query answer. Free (TRANSPARENT) and cancelled events don't block anything. */
export function busyFromIcs(ics: string, zone: string): BusyRange[] {
  const out: BusyRange[] = [];
  for (const e of parseVEvents(ics)) {
    if (e.get("TRANSP")?.value.toUpperCase() === "TRANSPARENT" || e.get("STATUS")?.value.toUpperCase() === "CANCELLED") continue;
    const dtstart = e.get("DTSTART");
    if (!dtstart) continue;
    const start = icsTime(dtstart, zone);
    const dtend = e.get("DTEND");
    const duration = e.get("DURATION");
    let end: Date;
    if (dtend) end = icsTime(dtend, zone).at;
    else if (duration) end = addDuration(start.at, duration.value, zone);
    else end = start.date ? addDuration(start.at, "P1D", zone) : start.at; // RFC 5545: a DATE alone lasts the day
    if (end > start.at) out.push({ start: start.at, end });
  }
  return out;
}

const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** UID from the booking id, so a retried insert lands on the same resource instead of a second event. */
export const icloudUid = (bookingId: string) => `hourhand-${bookingId}`;

function eventIcs(uid: string, e: { summary: string; description?: string; start: Date; end: Date; location?: string | null }, now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hourhand//Bookings//EN", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`, `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []), ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

// --- client ----------------------------------------------------------------------------------------------------

export function icloudClient(opts: { baseUrl?: string; fetchImpl?: Fetch; now?: () => Date } = {}) {
  const base = new URL(opts.baseUrl ?? ICLOUD_CALDAV_URL);
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());

  async function dav(credential: string, method: string, url: URL, o: { depth?: string; body?: string; headers?: Record<string, string>; okStatuses?: number[]; contentType?: string } = {}): Promise<{ status: number; text: string; url: URL }> {
    let target = allowedUrl(url.toString(), base);
    for (let hop = 0; hop < 5; hop++) {
      let res: Response;
      try {
        res = await f(target.toString(), {
          method, redirect: "manual", signal: AbortSignal.timeout(15_000),
          headers: {
            authorization: `Basic ${Buffer.from(credential).toString("base64")}`,
            ...(o.depth ? { depth: o.depth } : {}), ...(o.body ? { "content-type": o.contentType ?? "application/xml; charset=utf-8" } : {}), ...o.headers,
          },
          body: o.body,
        });
      } catch (error) {
        throw new CalendarApiError(`Could not reach iCloud: ${(error as Error).name}`, { retryable: true });
      }
      if ([301, 302, 307, 308].includes(res.status) && res.headers.get("location")) {
        target = allowedUrl(res.headers.get("location")!, target); // each hop is checked before the credential goes anywhere
        continue;
      }
      const text = await res.text();
      if (res.ok || o.okStatuses?.includes(res.status)) return { status: res.status, text, url: target };
      throw new CalendarApiError(`iCloud ${method} ${target.pathname} ${res.status}`, {
        status: res.status, retryable: res.status === 429 || res.status >= 500, revoked: res.status === 401 || res.status === 403,
      });
    }
    throw new CalendarApiError("iCloud redirected too many times", { retryable: true });
  }

  const propfind = (credential: string, url: URL, depth: string, props: string) =>
    dav(credential, "PROPFIND", url, { depth, body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${props}</d:prop></d:propfind>` });

  /** current-user-principal, then calendar-home-set. Throws `revoked` on a wrong Apple ID or password. */
  async function home(credential: string): Promise<URL> {
    const p = await propfind(credential, base, "0", "<d:current-user-principal/>");
    const principal = parseMultistatus(p.text).map((r) => hrefIn(r.props, "current-user-principal")).find(Boolean);
    if (!principal) throw new CalendarApiError("iCloud did not name the account's principal", { retryable: false });
    const h = await propfind(credential, allowedUrl(principal, p.url), "0", "<c:calendar-home-set/>");
    const homeHref = parseMultistatus(h.text).map((r) => hrefIn(r.props, "calendar-home-set")).find(Boolean);
    if (!homeHref) throw new CalendarApiError("iCloud did not name the calendar home", { retryable: false });
    return allowedUrl(homeHref, h.url);
  }

  /** Calendars the account can see; ids are absolute calendar URLs. Each is checked against the allow-list on every use. */
  async function listCalendars(credential: string): Promise<(CalendarEntry & { ctag: string | null })[]> {
    const h = await home(credential);
    const res = await propfind(credential, h, "1",
      "<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/><cs:getctag/>");
    const out: (CalendarEntry & { ctag: string | null })[] = [];
    for (const r of parseMultistatus(res.text)) {
      const type = elements(r.props, "resourcetype")[0] ?? "";
      if (elements(type, "calendar").length === 0) continue;
      const comps = elements(r.props, "supported-calendar-component-set")[0];
      if (comps !== undefined && !/name\s*=\s*["']VEVENT["']/i.test(comps)) continue; // reminders lists and the like
      const privs = elements(r.props, "current-user-privilege-set")[0] ?? "";
      const write = ["write", "write-content", "all"].some((p) => elements(privs, p).length > 0);
      const id = allowedUrl(r.href, res.url).toString();
      out.push({
        id, name: xmlText(elements(r.props, "displayname")[0] ?? "").trim() || id, primary: false,
        accessRole: write ? "owner" : "reader", ctag: xmlText(elements(r.props, "getctag")[0] ?? "").trim() || null,
      });
    }
    const first = out.find((c) => c.accessRole === "owner");
    if (first) first.primary = true; // iCloud has no default flag; the first writable calendar stands in for it
    return out;
  }

  const calUrl = (calendarId: string) => allowedUrl(calendarId.endsWith("/") ? calendarId : `${calendarId}/`, base);
  const eventUrl = (calendarId: string, uid: string) => new URL(`${encodeURIComponent(uid)}.ics`, calUrl(calendarId));

  return {
    id: "icloud" as const,
    /** Discovery alone: proves the Apple ID and app-specific password before anything is saved. */
    verify: async (credential: string) => { await home(credential); },
    listCalendars,

    /** Expanded calendar-query per calendar, so recurring events arrive as plain instances in the window. */
    async busy(credential: string, calendarIds: string[], timeMin: Date, timeMax: Date, busyOpts?: { timeZone?: string }) {
      const zone = busyOpts?.timeZone ?? "UTC";
      const busy = new Map<string, BusyRange[]>();
      const errors = new Map<string, string>();
      const range = `start="${icsUtc(timeMin)}" end="${icsUtc(timeMax)}"`;
      const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
      for (const id of calendarIds) {
        try {
          const res = await dav(credential, "REPORT", calUrl(id), { depth: "1", body });
          const ranges: BusyRange[] = [];
          for (const r of parseMultistatus(res.text)) for (const data of elements(r.props, "calendar-data")) ranges.push(...busyFromIcs(xmlText(data), zone));
          busy.set(id, ranges);
        } catch (error) {
          // A calendar that was deleted or unshared is named; a dead password or an outage fails the whole call.
          if (error instanceof CalendarApiError && error.status === 404) errors.set(id, "404");
          else throw error;
        }
      }
      return { busy, errors };
    },

    /** iCloud makes no video links; the guest's details go in the description since no invitation is sent. */
    async insertEvent(credential: string, calendarId: string, e: EventInput): Promise<EventResult> {
      const uid = icloudUid(e.bookingId);
      const description = e.description.includes(e.attendee.email) ? e.description : `Guest: ${e.attendee.name} <${e.attendee.email}>\n\n${e.description}`;
      // A retried insert whose first try landed meets 412; the event is there either way.
      await dav(credential, "PUT", eventUrl(calendarId, uid), {
        body: eventIcs(uid, { ...e, description }, now()), contentType: "text/calendar; charset=utf-8", headers: { "if-none-match": "*" }, okStatuses: [412],
      });
      return { id: uid, joinUrl: null, conferencePending: false };
    },

    async getEvent(_credential: string, _calendarId: string, eventId: string): Promise<EventResult> {
      return { id: eventId, joinUrl: null, conferencePending: false };
    },

    /** Rewrites the times and title of the stored event, keeping the guest's details and anything the host added. */
    async moveEvent(credential: string, calendarId: string, eventId: string, start: Date, end: Date, _timeZone: string, summary: string): Promise<EventResult> {
      const url = eventUrl(calendarId, eventId);
      const old = await dav(credential, "GET", url, { okStatuses: [404] });
      const body = old.status === 200 && /BEGIN:VEVENT/.test(old.text)
        ? old.text.replace(/\r?\n[ \t]/g, "") // unfold, so a long line is one line
          .replace(/^(DTSTART|DTEND|DURATION|DTSTAMP|SUMMARY)[;:].*\r?\n/gm, "")
          .replace(/^(BEGIN:VEVENT\r?\n)/m, `$1DTSTAMP:${icsUtc(now())}\r\nDTSTART:${icsUtc(start)}\r\nDTEND:${icsUtc(end)}\r\nSUMMARY:${icsEscape(summary)}\r\n`)
        : eventIcs(eventId, { summary, start, end }, now());
      await dav(credential, "PUT", url, { body, contentType: "text/calendar; charset=utf-8" });
      return { id: eventId, joinUrl: null, conferencePending: false };
    },

    async deleteEvent(credential: string, calendarId: string, eventId: string): Promise<void> {
      await dav(credential, "DELETE", eventUrl(calendarId, eventId), { okStatuses: [404, 410] });
    },
  };
}

export type ICloudClient = ReturnType<typeof icloudClient>;
