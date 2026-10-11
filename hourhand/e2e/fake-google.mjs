// A tiny fake of Google's OAuth and Calendar endpoints for the end-to-end run. Usage: node e2e/fake-google.mjs <port>
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const state = { tokenRequests: [], events: {}, busy: [], refreshes: 0, revoked: [], watches: [], stopped: [] };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const idToken = (email) => `h.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.s`;
const SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.owned";

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const body = await read(req);
  const p = url.pathname;
  if (p === "/__state") return json(res, 200, state);
  if (p === "/__busy" && req.method === "POST") { state.busy = JSON.parse(body); return json(res, 200, {}); }
  if (p === "/token") {
    const form = Object.fromEntries(new URLSearchParams(body));
    state.tokenRequests.push(form);
    if (form.grant_type === "authorization_code") {
      if (form.code !== "good-code") return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: "fake-at-0", refresh_token: "fake-rt", expires_in: 3600, scope: SCOPES, id_token: idToken("priya.real@gmail.com") });
    }
    state.refreshes++;
    return json(res, 200, { access_token: `fake-at-${state.refreshes}`, expires_in: 3600 });
  }
  if (p === "/revoke") { state.revoked.push(Object.fromEntries(new URLSearchParams(body)).token); return json(res, 200, {}); }
  if (!/^Bearer fake-at-\d+$/.test(req.headers.authorization ?? "")) return json(res, 401, { error: { message: "bad token" } });
  if (p === "/calendar/v3/users/me/calendarList") {
    return json(res, 200, { items: [{ id: "priya.real@gmail.com", summary: "Priya", primary: true, accessRole: "owner" }, { id: "holidays", summary: "Holidays", accessRole: "reader" }] });
  }
  if (p === "/calendar/v3/freeBusy") {
    const q = JSON.parse(body);
    return json(res, 200, { calendars: Object.fromEntries(q.items.map((i) => [i.id, { busy: i.id === "priya.real@gmail.com" ? state.busy : [] }])) });
  }
  const w = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/watch$/.exec(p);
  if (w && req.method === "POST") {
    const ch = JSON.parse(body);
    // Google doesn't watch read-only holiday calendars; neither does the fake.
    if (decodeURIComponent(w[1]) === "holidays") return json(res, 400, { error: { errors: [{ reason: "pushNotSupportedForRequestedResource" }], message: "Push notifications are not supported by this resource." } });
    state.watches.push({ calendarId: decodeURIComponent(w[1]), id: ch.id, token: ch.token, address: ch.address });
    return json(res, 200, { kind: "api#channel", id: ch.id, resourceId: `res-${w[1]}`, expiration: String(Date.now() + Number(ch.params?.ttl ?? 604800) * 1000) });
  }
  if (p === "/calendar/v3/channels/stop" && req.method === "POST") { state.stopped.push(JSON.parse(body).id); res.writeHead(204); return res.end(); }
  const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p);
  if (m) {
    const cal = decodeURIComponent(m[1]);
    const id = m[2] && decodeURIComponent(m[2]);
    if (req.method === "POST") {
      const e = JSON.parse(body);
      if (state.events[e.id]) return json(res, 409, { error: { errors: [{ reason: "duplicate" }] } });
      state.events[e.id] = { ...e, calendar: cal, sendUpdates: url.searchParams.get("sendUpdates"), hangoutLink: e.conferenceData ? `https://meet.google.com/${e.id.slice(2, 5)}-${e.id.slice(5, 9)}-${e.id.slice(9, 12)}` : undefined };
      return json(res, 200, state.events[e.id]);
    }
    if (!state.events[id]) return json(res, req.method === "DELETE" ? 410 : 404, {});
    if (req.method === "GET") return json(res, 200, state.events[id]);
    if (req.method === "PATCH") { Object.assign(state.events[id], JSON.parse(body)); return json(res, 200, state.events[id]); }
    if (req.method === "DELETE") { delete state.events[id]; res.writeHead(204); return res.end(); }
  }
  json(res, 404, { error: { message: `fake google has no ${req.method} ${p}` } });
}).listen(port, () => console.log(`fake google on ${port}`));
