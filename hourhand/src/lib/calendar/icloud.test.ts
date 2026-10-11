import { describe, expect, it } from "vitest";
import { busyFromIcs, icloudClient } from "./icloud";
import { CalendarApiError } from "./provider";

const BASE = "https://caldav.icloud.com";
const CRED = "host@icloud.com:abcd-efgh-ijkl-mnop";
const ms = (xml: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${xml}</d:multistatus>`;

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A fake iCloud: routes by method + path; records every request. */
function fake(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method as string, headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    calls.push(c);
    const handler = routes[`${c.method} ${new URL(url).pathname}`] ?? routes[`${c.method} *`];
    return handler ? handler(c) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, client: icloudClient({ baseUrl: BASE, fetchImpl, now: () => new Date("2026-11-01T00:00:00Z") }) };
}

const P = "/123/principal/";
const discovery = {
  "PROPFIND /": () => new Response(ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>${P}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`), { status: 207 }),
  [`PROPFIND ${P}`]: () => new Response(ms(`<d:response><d:href>${P}</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>https://p01-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`), { status: 207 }),
};

describe("iCloud CalDAV", () => {
  it("discovers principal then calendar home, and lists only event calendars with their write access", async () => {
    const cal = (href: string, name: string, comp: string, priv: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${name}</d:displayname><c:supported-calendar-component-set><c:comp name="${comp}"/></c:supported-calendar-component-set><d:current-user-privilege-set>${priv}</d:current-user-privilege-set><cs:getctag xmlns:cs="http://calendarserver.org/ns/">ctag-1</cs:getctag></d:prop></d:propstat></d:response>`;
    const { calls, client } = fake({
      ...discovery,
      "PROPFIND /123/calendars/": () => new Response(ms(
        "<d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>"
        + cal("/123/calendars/work/", "Work &amp; Life", "VEVENT", "<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>")
        + cal("/123/calendars/family/", "Family", "VEVENT", "<d:privilege><d:read/></d:privilege>")
        + cal("/123/calendars/tasks/", "Reminders", "VTODO", "<d:privilege><d:write/></d:privilege>")), { status: 207 }),
    });
    const cals = await client.listCalendars(CRED);
    expect(cals).toEqual([
      { id: "https://p01-caldav.icloud.com/123/calendars/work/", name: "Work & Life", primary: true, accessRole: "owner", ctag: "ctag-1" },
      { id: "https://p01-caldav.icloud.com/123/calendars/family/", name: "Family", primary: false, accessRole: "reader", ctag: "ctag-1" },
    ]);
    expect(calls.map((c) => [c.method, c.url, c.headers.depth])).toEqual([
      ["PROPFIND", `${BASE}/`, "0"], ["PROPFIND", `${BASE}${P}`, "0"], ["PROPFIND", "https://p01-caldav.icloud.com/123/calendars/", "1"],
    ]);
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from(CRED).toString("base64")}`);
  });

  it("refuses to send the credential to a host outside icloud.com", async () => {
    const { calls, client } = fake({
      "PROPFIND /": () => new Response(ms("<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>https://evil.example/p/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>"), { status: 207 }),
      "PROPFIND *": () => new Response(ms(""), { status: 207 }),
    });
    await expect(client.verify(CRED)).rejects.toThrow(/outside icloud\.com/);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/`]);
    // Redirects are checked per hop too, and lookalike hosts fail.
    const r = fake({ "PROPFIND /": () => new Response("", { status: 301, headers: { location: "https://icloud.com.evil.example/" } }) });
    await expect(r.client.verify(CRED)).rejects.toThrow(/outside icloud\.com/);
    expect(r.calls).toHaveLength(1);
  });

  it("refuses XML carrying a DTD", async () => {
    const { client } = fake({ "PROPFIND /": () => new Response('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><d:multistatus xmlns:d="DAV:"/>', { status: 207 }) });
    await expect(client.verify(CRED)).rejects.toThrow(/DTD/);
  });

  it("a wrong password is revoked, an outage retryable, and neither message carries the password", async () => {
    const bad = fake({ "PROPFIND /": () => new Response("", { status: 401 }) });
    const e = (await bad.client.verify(CRED).catch((x) => x)) as CalendarApiError;
    expect(e).toBeInstanceOf(CalendarApiError);
    expect(e).toMatchObject({ revoked: true, retryable: false, status: 401 });
    expect(e.message).not.toContain("abcd");
    const down = fake({ "PROPFIND /": () => new Response("", { status: 503 }) });
    await expect(down.client.verify(CRED)).rejects.toMatchObject({ revoked: false, retryable: true });
  });

  it("busy asks for an expanded time range and reads each calendar's events", async () => {
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261103T090000Z\r\nDTEND:20261103T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const { calls, client } = fake({
      "REPORT /123/calendars/work/": () => new Response(ms(`<d:response><d:href>/123/calendars/work/a.ics</d:href><d:propstat><d:prop><c:calendar-data>${ics}</c:calendar-data></d:prop></d:propstat></d:response>`), { status: 207 }),
    });
    const id = "https://caldav.icloud.com/123/calendars/work/";
    const gone = "https://caldav.icloud.com/123/calendars/gone/";
    const { busy, errors } = await client.busy(CRED, [id, gone], new Date("2026-11-01T00:00:00Z"), new Date("2026-11-08T00:00:00Z"), { timeZone: "Asia/Kolkata" });
    expect(busy.get(id)).toEqual([{ start: new Date("2026-11-03T09:00:00Z"), end: new Date("2026-11-03T10:00:00Z") }]);
    expect([...errors]).toEqual([[gone, "404"]]);
    expect(calls[0].headers.depth).toBe("1");
    expect(calls[0].body).toContain('<c:expand start="20261101T000000Z" end="20261108T000000Z"/>');
    expect(calls[0].body).toContain('<c:time-range start="20261101T000000Z" end="20261108T000000Z"/>');
  });

  it("parses timed UTC, TZID, DURATION, all-day in the host's zone, expanded instances; skips free and cancelled", () => {
    const ev = (lines: string) => `BEGIN:VEVENT\r\n${lines}\r\nEND:VEVENT`;
    const ics = ["BEGIN:VCALENDAR",
      ev("UID:utc\r\nDTSTART:20261103T090000Z\r\nDTEND:20261103T100000Z"),
      ev("UID:tz\r\nDTSTART;TZID=America/New_York:20261103T090000\r\nDTEND;TZID=America/New_York:20261103T093000"),
      ev("UID:dur\r\nDTSTART:20261104T120000Z\r\nDURATION:PT1H30M\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nDURATION:PT5M\r\nEND:VALARM"),
      ev("UID:allday\r\nDTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261106"),
      ev("UID:free\r\nDTSTART:20261106T090000Z\r\nDTEND:20261106T100000Z\r\nTRANSP:TRANSPARENT"),
      ev("UID:cancelled\r\nDTSTART:20261106T110000Z\r\nDTEND:20261106T120000Z\r\nSTATUS:CANCELLED"),
      ev("UID:weekly\r\nRECURRENCE-ID:20261102T080000Z\r\nDTSTART:20261102T080000Z\r\nDTEND:20261102T083000Z"),
      ev("UID:weekly\r\nRECURRENCE-ID:20261109T080000Z\r\nDTSTART:20261109T080000Z\r\nDTEND:20261109T083000Z"),
      "END:VCALENDAR"].join("\r\n");
    expect(busyFromIcs(ics, "Asia/Kolkata")).toEqual([
      { start: new Date("2026-11-03T09:00:00Z"), end: new Date("2026-11-03T10:00:00Z") },
      { start: new Date("2026-11-03T14:00:00Z"), end: new Date("2026-11-03T14:30:00Z") },
      { start: new Date("2026-11-04T12:00:00Z"), end: new Date("2026-11-04T13:30:00Z") },
      // 5 Nov, midnight to midnight in Kolkata (UTC+5:30)
      { start: new Date("2026-11-04T18:30:00Z"), end: new Date("2026-11-05T18:30:00Z") },
      { start: new Date("2026-11-02T08:00:00Z"), end: new Date("2026-11-02T08:30:00Z") },
      { start: new Date("2026-11-09T08:00:00Z"), end: new Date("2026-11-09T08:30:00Z") },
    ]);
    // A DATE with no DTEND blocks that one host day.
    expect(busyFromIcs("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261105\r\nEND:VEVENT", "Asia/Kolkata"))
      .toEqual([{ start: new Date("2026-11-04T18:30:00Z"), end: new Date("2026-11-05T18:30:00Z") }]);
  });

  it("inserts with If-None-Match, moves by PUT, deletes treating gone as done; never a video link", async () => {
    const { calls, client } = fake({ "PUT *": () => new Response("", { status: 201 }), "DELETE *": () => new Response("", { status: 404 }) });
    const cal = "https://caldav.icloud.com/123/calendars/work/";
    const r = await client.insertEvent(CRED, cal, {
      summary: "Coaching", description: "Notes", start: new Date("2026-11-03T09:00:00Z"), end: new Date("2026-11-03T10:00:00Z"),
      timeZone: "Asia/Kolkata", location: null, attendee: { email: "g@example.com", name: "Guest" }, conference: null, bookingId: "b-1",
    });
    expect(r).toEqual({ id: "hourhand-b-1", joinUrl: null, conferencePending: false });
    expect(calls[0]).toMatchObject({ method: "PUT", url: `${cal}hourhand-b-1.ics` });
    expect(calls[0].headers["if-none-match"]).toBe("*");
    expect(calls[0].headers["content-type"]).toMatch(/^text\/calendar/);
    expect(calls[0].body).toContain("UID:hourhand-b-1\r\n");
    expect(calls[0].body).toContain("DTSTART:20261103T090000Z\r\nDTEND:20261103T100000Z");
    expect(calls[0].body).toContain("Guest: Guest <g@example.com>");

    await client.moveEvent(CRED, cal, "hourhand-b-1", new Date("2026-11-04T09:00:00Z"), new Date("2026-11-04T10:00:00Z"), "Asia/Kolkata", "Coaching");
    expect(calls[1]).toMatchObject({ method: "PUT", url: `${cal}hourhand-b-1.ics` });
    expect(calls[1].headers["if-none-match"]).toBeUndefined();
    expect(calls[1].body).toContain("DTSTART:20261104T090000Z");

    await expect(client.deleteEvent(CRED, cal, "hourhand-b-1")).resolves.toBeUndefined();
    expect(calls[2]).toMatchObject({ method: "DELETE", url: `${cal}hourhand-b-1.ics` });
  });
});
