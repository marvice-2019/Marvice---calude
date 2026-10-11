// B6 end to end: connect Outlook, sync busy times, Teams booking, rotated refresh tokens, cancel. Against the fake Microsoft only.
// Usage: node e2e/e2e-b6.mjs <port> <server-log> <database-url> <fake-microsoft-port>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];
const [port, logPath, databaseUrl, msPort] = process.argv.slice(2);
const B = `http://localhost:${port}`;
const M = `http://127.0.0.1:${msPort}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
async function waitFor(pred, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(250); } return pred(); }
const ms = async () => (await fetch(`${M}/__state`)).json();
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    take(res) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";"); const i = pair.indexOf("=");
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (/max-age=0/i.test(raw) || value === "") cookies.delete(name); else cookies.set(name, value);
      }
    },
  };
}
const get = async (path, j) => { const res = await fetch(B + path, { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.80", ...(j ? { cookie: j.header() } : {}) }, signal: t() }); j?.take(res); return res; };

await sleep(2500);
check(/calendars microsoft \+ icloud on, booking/.test(log()), "job runner started with Microsoft and iCloud (no Google configured)");
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
await pool.query("delete from calendar_connections where user_id = $1", [priya.id]);
// The coaching session meets on Teams for this run.
await pool.query("update event_locations set kind = 'teams', value = null where event_type_id = (select id from event_types where slug = 'coaching' and user_id = $1)", [priya.id]);

await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": "203.0.113.80" }, body: JSON.stringify({ email: priya.email, callbackURL: "/dashboard/calendars" }), signal: t() });
await sleep(300);
const j = jar();
await get(lastLink(log(), priya.email).replace(/^https?:\/\/[^/]+/, ""), j);

let page = await (await get("/dashboard/calendars", j)).text();
check(page.includes("Connect Outlook") && !page.includes("Connect Google Calendar"), "calendars page offers Outlook only (Google isn't configured)");

const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots ?? [];
const before = await slots();
const busySlot = before.find((s) => new Date(s).getTime() > Date.now() + 2 * 864e5);
const freeSlot = before.find((s) => new Date(s).getTime() > Date.now() + 3 * 864e5);
await fetch(`${M}/__busy`, { method: "POST", body: JSON.stringify([
  { start: busySlot, end: new Date(new Date(busySlot).getTime() + 45 * 60_000).toISOString() },
  { start: freeSlot, end: new Date(new Date(freeSlot).getTime() + 45 * 60_000).toISOString(), showAs: "free" }]) });

const start = await get("/api/calendars/microsoft/connect", j);
const to_ = new URL(start.headers.get("location"));
check(start.status === 307 && to_.origin === M && to_.pathname === "/common/oauth2/v2.0/authorize", `connect -> ${start.status} to the (fake) Microsoft sign-in`);
check(/Calendars\.ReadWrite/.test(to_.searchParams.get("scope")) && /offline_access/.test(to_.searchParams.get("scope")), "asks for Calendars.ReadWrite and offline_access");
check(j.header().includes("hh_mcal_oauth=") && !j.header().includes("hh_gcal_oauth="), "Outlook handshake cookie set (not Google's)");
const state = to_.searchParams.get("state"), challenge = to_.searchParams.get("code_challenge");

const forged = await get(`/api/calendars/microsoft/callback?code=good-code&state=forged`, j);
check((forged.headers.get("location") ?? "").includes("error=state_mismatch"), `forged state -> ${forged.headers.get("location")}`);
const again = await get("/api/calendars/microsoft/connect", j);
const state2 = new URL(again.headers.get("location")).searchParams.get("state");
const challenge2 = new URL(again.headers.get("location")).searchParams.get("code_challenge");
check(state !== state2 && challenge !== challenge2, "each handshake gets a fresh state and PKCE challenge");
const viaGoogle = await get(`/api/calendars/google/callback?code=good-code&state=${state2}`, j);
check(!(viaGoogle.headers.get("location") ?? "").includes("connected=1"), `the Outlook handshake can't be finished on the Google callback (${viaGoogle.headers.get("location")})`);
const anon = await get(`/api/calendars/microsoft/callback?code=good-code&state=${state2}`);
check((anon.headers.get("location") ?? "").includes("/sign-in"), `callback with no session -> ${anon.headers.get("location")}`);

const done = await get(`/api/calendars/microsoft/callback?code=good-code&state=${state2}`, j);
check((done.headers.get("location") ?? "").includes("connected=1"), `callback -> ${done.headers.get("location")}`);
const exchange = (await ms()).tokenRequests.find((r) => r.grant_type === "authorization_code");
check(exchange && createHash("sha256").update(exchange.code_verifier).digest("base64url") === challenge2, "code exchanged with the PKCE verifier matching the challenge");

const { rows: [conn] } = await pool.query("select id, provider, account_email, status, credentials_encrypted from calendar_connections where user_id = $1", [priya.id]);
check(conn?.provider === "microsoft" && conn.account_email === "priya@coaching.example", "Outlook connection saved with the account from the id token");
check(!conn.credentials_encrypted.toString("latin1").includes("ms-rt-"), "tokens not readable in the database");
const { rows: cals } = await pool.query("select name, access_role, can_teams, check_conflicts from calendars where connection_id = $1 order by name", [conn.id]);
check(cals.length === 2 && cals.find((c) => c.name === "Calendar")?.access_role === "owner" && cals.find((c) => c.name === "India holidays")?.access_role === "reader", `calendars listed with roles (${cals.map((c) => `${c.name}:${c.access_role}`).join(", ")})`);
check(cals.find((c) => c.name === "Calendar")?.can_teams === true, "the work calendar is marked as able to make Teams meetings");
check(await waitFor(async () => (await pool.query("select last_synced_at from calendar_connections where id = $1", [conn.id])).rows[0].last_synced_at !== null), "first sync ran straight away");
const after = await slots();
check(!after.includes(busySlot), "the Outlook-busy slot is no longer offered");
check(after.includes(freeSlot), "an Outlook event marked 'free' doesn't block the time");
page = await (await get("/dashboard/calendars", j)).text();
check(page.includes("Microsoft") && page.includes("priya@coaching.example") && page.includes("In sync"), "calendars page shows the Microsoft account in sync");

// Book a Teams session: the event lands in Outlook with a Teams meeting, and the guest's confirmation carries the link.
const { rows: [q] } = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const email = `b6-${Date.now()}@example.com`;
const slot = after.filter((s) => s !== freeSlot).at(-1);
const res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.81" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: slot, name: "Kiran Rao", email, timezone: "Asia/Kolkata", answers: { [q.id]: "Plan" }, idempotencyKey: `e2e-b6-${Date.now()}` }) });
const booked = await res.json();
check(res.status === 201, `booking -> ${res.status}`);
check(await waitFor(async () => Object.keys((await ms()).events).length === 1, 15000), "event created in the host's Outlook calendar");
const event = Object.values((await ms()).events)[0];
check(event.calendar === "AAMk-cal-main" && event.isOnlineMeeting && event.onlineMeetingProvider === "teamsForBusiness", "event is a Teams meeting in the default calendar");
check(event.transactionId === booked.bookingId, "the create carries the booking id as transactionId (retries can't double-book)");
check(!event.attendees && JSON.stringify(event.body ?? "").includes(email), "no attendees (Outlook would email the guest its own invite); the guest is named in the event body");
check(await waitFor(() => log().includes(`[dev] email to ${email}: Booked:`) && log().includes(event.joinUrl), 20000), "guest confirmation carries the Teams link");
const { rows: [b] } = await pool.query("select join_url, external_event_id from bookings where id = $1", [booked.bookingId]);
check(b.join_url === event.joinUrl && b.external_event_id === event.id, "booking stores the Teams link and the Outlook event id");

// Rotated refresh tokens: the fake gives 30-second tokens and accepts only the latest refresh token.
const st = await ms();
check(st.refreshes >= 1 && st.refreshTokensSeen.every((rt, i) => rt === `ms-rt-${i}`), `refresh tokens rotated and each new one was used next (${st.refreshes} refreshes)`);
check((await pool.query("select status from calendar_connections where id = $1", [conn.id])).rows[0].status === "ok", "connection still healthy after rotations");

const cancel = await fetch(`${B}/api/b/${booked.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: t() });
check(cancel.status === 200, `guest cancels -> ${cancel.status}`);
check(await waitFor(async () => Object.keys((await ms()).events).length === 0, 15000), "event removed from Outlook");

check(!/Unhandled|TypeError/.test(log()), "no errors in the server log");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
