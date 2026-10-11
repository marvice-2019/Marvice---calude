// B4a end to end against the local server and the fake Google only.
// Usage: node e2e/e2e-b4.mjs <port> <server-log> <database-url> <fake-google-port>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

/** The last sign-in link the log mailer printed for `email` (the email's "Sign in:" line). */
const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];

const [port, logPath, databaseUrl, googlePort] = process.argv.slice(2);
const B = `http://localhost:${port}`;
const G = `http://127.0.0.1:${googlePort}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
async function waitFor(pred, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(250); } return pred(); }
const google = async () => (await fetch(`${G}/__state`)).json();

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    take(res) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (/max-age=0/i.test(raw) || value === "") cookies.delete(name); else cookies.set(name, value);
      }
    },
  };
}
const get = async (path, j) => { const res = await fetch(B + path, { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.70", ...(j ? { cookie: j.header() } : {}) }, signal: t() }); j?.take(res); return res; };

await sleep(2500);
check(/calendars google \+ icloud on, Google instant/.test(log()), "job runner started with Google Calendar (and iCloud) on, instant sync");
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
// A real host has no demo connection.
await pool.query("delete from calendar_connections where user_id = $1", [priya.id]);

// Sign in as Priya through the magic link
await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": "203.0.113.70" }, body: JSON.stringify({ email: priya.email, callbackURL: "/dashboard/calendars" }), signal: t() });
await sleep(300);
const link = lastLink(log(), priya.email);
const j = jar();
await get(link.replace(/^https?:\/\/[^/]+/, ""), j);

// Pick a slot two days out and make Priya busy then in Google
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots ?? [];
const before = await slots();
const busySlot = before.find((s) => new Date(s).getTime() > Date.now() + 2 * 864e5);
await fetch(`${G}/__busy`, { method: "POST", body: JSON.stringify([{ start: busySlot, end: new Date(new Date(busySlot).getTime() + 45 * 60_000).toISOString() }]) });

// Start the handshake
const start = await get("/api/calendars/google/connect", j);
const to_ = new URL(start.headers.get("location"));
check(start.status === 307 && to_.origin === G && to_.pathname === "/o/oauth2/v2/auth", `connect -> ${start.status} to the (fake) Google consent screen`);
check(to_.searchParams.get("scope").includes("calendar.events.owned") && !/auth\/calendar(\s|$)/.test(to_.searchParams.get("scope")), "asks for the narrow calendar scopes");
check(j.header().includes("hh_gcal_oauth="), "handshake cookie set");
const state = to_.searchParams.get("state");

// A callback with a forged state is refused
const forged = await get(`/api/calendars/google/callback?code=good-code&state=forged`, j);
check((forged.headers.get("location") ?? "").includes("error=state_mismatch"), `forged state -> ${forged.headers.get("location")}`);
// The forged attempt cleared the cookie, so start again
const again = await get("/api/calendars/google/connect", j);
const state2 = new URL(again.headers.get("location")).searchParams.get("state");
const challenge = new URL(again.headers.get("location")).searchParams.get("code_challenge");

// A callback without a session is refused
const anon = await get(`/api/calendars/google/callback?code=good-code&state=${state2}`);
check((anon.headers.get("location") ?? "").includes("/sign-in"), `callback with no session -> ${anon.headers.get("location")}`);

const done = await get(`/api/calendars/google/callback?code=good-code&state=${state2}`, j);
check((done.headers.get("location") ?? "").includes("connected=1"), `callback -> ${done.headers.get("location")}`);
const g1 = await google();
const exchange = g1.tokenRequests.find((r) => r.grant_type === "authorization_code");
check(exchange && createHash("sha256").update(exchange.code_verifier).digest("base64url") === challenge, "code exchanged with the PKCE verifier matching the challenge");
check(state !== state2, "each handshake gets a fresh state");

const { rows: [conn] } = await pool.query("select id, account_email, status, credentials_encrypted from calendar_connections where user_id = $1", [priya.id]);
check(conn?.account_email === "priya.real@gmail.com" && !conn.credentials_encrypted.toString("latin1").includes("fake-rt"), "connection saved, tokens not readable in the database");
check(await waitFor(async () => (await pool.query("select last_synced_at from calendar_connections where id = $1", [conn.id])).rows[0].last_synced_at !== null), "first sync ran straight away");
const after = await slots();
check(!after.includes(busySlot) && after.length > 0, `the Google-busy slot is no longer offered (${before.length} -> ${after.length} slots)`);
const page = await (await get("/dashboard/calendars", j)).text();
check(page.includes("priya.real@gmail.com") && page.includes("In sync"), "calendars page shows the account in sync");

// Instant sync: the job runner watches the calendar; a ping from Google syncs it now instead of at the next 5-minute poll
check(await waitFor(async () => (await google()).watches.some((x) => x.calendarId === "priya.real@gmail.com")), "job runner asked Google to watch the checked calendar");
const watch = (await google()).watches.find((x) => x.calendarId === "priya.real@gmail.com");
check(watch.address === `${B}/api/webhooks/google-calendar` && watch.token.length >= 32, "watch points at the ping endpoint with its own token");
const syncedAt = async () => (await pool.query("select last_synced_at from calendar_connections where id = $1", [conn.id])).rows[0].last_synced_at.getTime();
const ping = (token) => fetch(`${B}/api/webhooks/google-calendar`, { method: "POST", signal: t(),
  headers: { "x-goog-channel-id": watch.id, "x-goog-channel-token": token, "x-goog-resource-state": "exists", "x-goog-resource-id": "res", "x-goog-message-number": "2" } });
const busy2 = after.find((s) => s !== busySlot && new Date(s).getTime() > Date.now() + 3 * 864e5);
await fetch(`${G}/__busy`, { method: "POST", body: JSON.stringify([
  { start: busySlot, end: new Date(new Date(busySlot).getTime() + 45 * 60_000).toISOString() },
  { start: busy2, end: new Date(new Date(busy2).getTime() + 45 * 60_000).toISOString() }]) });
const before2 = await syncedAt();
const forgedPing = await ping("f".repeat(48));
await sleep(3000);
check(forgedPing.status === 204 && (await syncedAt()) === before2 && (await slots()).includes(busy2), "a ping with the wrong token answers the same and changes nothing");
const realPing = await ping(watch.token);
const pingedAt = Date.now();
check(realPing.status === 204 && await waitFor(async () => !(await slots()).includes(busy2), 40000), "a real ping syncs promptly: the newly busy time disappears without waiting for the 5-minute poll");
console.log(`     (took ${((Date.now() - pingedAt) / 1000).toFixed(1)}s; at most 30s after the previous sync by design)`);

// Book a Meet session; the event lands in Google with a Meet link, which the guest's confirmation carries
const { rows: [q] } = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching'");
const email = `b4-${Date.now()}@example.com`;
const res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.71" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: after.at(-1), name: "Kiran Rao", email, timezone: "Asia/Kolkata", answers: { [q.id]: "Plan" }, idempotencyKey: `e2e-b4-${Date.now()}` }) });
const booked = await res.json();
check(res.status === 201, `booking -> ${res.status}`);
check(await waitFor(async () => Object.keys((await google()).events).length === 1), "event created in the host's Google Calendar");
const event = Object.values((await google()).events)[0];
check(event.sendUpdates === "none" && event.attendees?.[0]?.email === email && event.hangoutLink, "event has the guest as attendee, a Meet link, and Google sent no email");
check(await waitFor(() => log().includes(`[dev] email to ${email}: Booked:`) && log().includes(event.hangoutLink), 12000), "guest confirmation carries the Meet link");

const cancel = await fetch(`${B}/api/b/${booked.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: t() });
check(cancel.status === 200, `guest cancels -> ${cancel.status}`);
check(await waitFor(async () => Object.keys((await google()).events).length === 0), "event removed from Google Calendar");

await pool.end();
process.exit(fail ? 1 : 0);
