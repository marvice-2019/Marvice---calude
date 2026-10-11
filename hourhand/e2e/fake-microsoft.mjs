// A tiny fake of Microsoft's login and Graph calendar endpoints for the end-to-end run.
// Usage: node e2e/fake-microsoft.mjs <port>; point MICROSOFT_LOGIN_BASE_URL and MICROSOFT_GRAPH_BASE_URL at it.
// Behaves like a work account: the "Calendar" calendar can create Teams meetings, the join link appears on the first read
// after the create. Refresh tokens rotate on every refresh, like Microsoft's.
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const state = { tokenRequests: [], events: {}, busy: [], refreshes: 0, creates: [], refreshTokensSeen: [] };
let seq = 0;
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read openid email";
const CALS = [
  { id: "AAMk-cal-main", name: "Calendar", isDefaultCalendar: true, canEdit: true, allowedOnlineMeetingProviders: ["teamsForBusiness"] },
  { id: "AAMk-cal-holidays", name: "India holidays", isDefaultCalendar: false, canEdit: false, allowedOnlineMeetingProviders: [] },
];
const utc = (d) => ({ dateTime: new Date(d).toISOString().replace("Z", "0000"), timeZone: "UTC" });
const view = (e) => ({ id: e.id, subject: e.subject, start: e.start, end: e.end, isOnlineMeeting: Boolean(e.isOnlineMeeting), onlineMeeting: e.joinReady ? { joinUrl: e.joinUrl } : null, attendees: e.attendees, transactionId: e.transactionId, calendar: e.calendar });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const body = await read(req);
  const p = url.pathname;
  if (p === "/__state") return json(res, 200, state);
  if (p === "/__busy" && req.method === "POST") { state.busy = JSON.parse(body); return json(res, 200, {}); }
  if (p === "/common/oauth2/v2.0/token") {
    const form = Object.fromEntries(new URLSearchParams(body));
    state.tokenRequests.push(form);
    if (form.grant_type === "authorization_code") {
      if (form.code !== "good-code") return json(res, 400, { error: "invalid_grant", error_description: "AADSTS70000: bad code" });
      return json(res, 200, { access_token: "ms-at-0", refresh_token: "ms-rt-0", expires_in: 30, scope: SCOPE, id_token: idToken({ preferred_username: "priya@coaching.example" }) });
    }
    state.refreshTokensSeen.push(form.refresh_token);
    if (form.refresh_token !== `ms-rt-${state.refreshes}`) return json(res, 400, { error: "invalid_grant", error_description: "AADSTS700082: refresh token expired" });
    state.refreshes++;
    return json(res, 200, { access_token: `ms-at-${state.refreshes}`, refresh_token: `ms-rt-${state.refreshes}`, expires_in: 30, scope: SCOPE });
  }
  if (!/^Bearer ms-at-\d+$/.test(req.headers.authorization ?? "")) return json(res, 401, { error: { code: "InvalidAuthenticationToken", message: "bad token" } });
  if (p === "/v1.0/me/calendars") return json(res, 200, { value: CALS });
  const cv = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(p);
  if (cv) {
    const cal = decodeURIComponent(cv[1]);
    const from = new Date(url.searchParams.get("startDateTime")), to = new Date(url.searchParams.get("endDateTime"));
    const items = cal === "AAMk-cal-main"
      ? [...state.busy.map((b, i) => ({ id: `busy-${i}`, start: utc(b.start), end: utc(b.end), showAs: b.showAs ?? "busy", isCancelled: false })),
         ...Object.values(state.events).filter((e) => e.calendar === cal).map((e) => ({ id: e.id, start: e.start, end: e.end, showAs: "busy", isCancelled: false }))]
        .filter((e) => new Date(`${e.start.dateTime}Z`) < to && new Date(`${e.end.dateTime}Z`) > from)
      : [];
    return json(res, 200, { value: items });
  }
  const m = /^\/v1\.0\/me\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p);
  if (m) {
    const cal = decodeURIComponent(m[1]);
    const id = m[2] && decodeURIComponent(m[2]);
    if (req.method === "POST") {
      const e = JSON.parse(body);
      state.creates.push(e.transactionId);
      const dup = Object.values(state.events).find((x) => x.transactionId && x.transactionId === e.transactionId);
      if (dup) return json(res, 201, view(dup)); // assumption under test: Graph returns the existing event for a repeated transactionId
      const evId = `AAMk-ev-${++seq}`;
      const teams = e.isOnlineMeeting && e.onlineMeetingProvider === "teamsForBusiness" && CALS.find((c) => c.id === cal)?.allowedOnlineMeetingProviders.includes("teamsForBusiness");
      state.events[evId] = { ...e, id: evId, calendar: cal, isOnlineMeeting: Boolean(teams), joinUrl: teams ? `https://teams.microsoft.com/l/meetup-join/fake-${seq}` : null, joinReady: false };
      return json(res, 201, view(state.events[evId]));
    }
    const ev = state.events[id];
    if (!ev || ev.calendar !== cal) return json(res, 404, { error: { code: "ErrorItemNotFound", message: "not found" } });
    if (req.method === "GET") { ev.joinReady = Boolean(ev.joinUrl); return json(res, 200, view(ev)); }
    if (req.method === "PATCH") { Object.assign(ev, JSON.parse(body)); return json(res, 200, view(ev)); }
    if (req.method === "DELETE") { delete state.events[id]; res.writeHead(204); return res.end(); }
  }
  json(res, 404, { error: { code: "NotFound", message: `fake microsoft has no ${req.method} ${p}` } });
}).listen(port, () => console.log(`fake microsoft on ${port}`));
