// C-5 iCloud end to end against e2e/fake-caldav.mjs. Usage: node e2e/e2e-icloud.mjs <port> <server-log> <database-url> <fake-port>
// Usage: node e2e/e2e-clients.mjs <port> <server-log> <database-url> <rzp-port>
import { readFileSync } from "node:fs";
import pg from "pg";

const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];
const [port, logPath, databaseUrl, calPort] = process.argv.slice(2);
const B = `http://localhost:${port}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
async function waitFor(pred, ms = 25000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(500); } return pred(); }
const ip = "203.0.113.94";

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
const get = async (path, j) => {
  const res = await fetch(B + path, { redirect: "manual", headers: { "x-forwarded-for": ip, ...(j ? { cookie: j.header() } : {}) }, signal: t() });
  j?.take(res);
  const text = res.text.bind(res);
  res.text = async () => (await text()).replace(/<!-- -->/g, "");
  return res;
};
async function signIn(email) {
  await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": ip }, body: JSON.stringify({ email, callbackURL: "/dashboard" }), signal: t() });
  await sleep(300);
  const j = jar();
  await get(lastLink(log(), email).replace(/^https?:\/\/[^/]+/, ""), j);
  return j;
}
/** Posts the no-JavaScript form on `path` whose markup contains `marker`, with `fields` filled in. */
async function submitForm(j, path, marker, fields) {
  const html = await (await get(path, j)).text();
  const form = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(marker));
  if (!form) return null;
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) if (m[1].startsWith("$ACTION")) fd.append(m[1], (m[2] ?? "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(B + path, { method: "POST", body: fd, redirect: "manual", headers: { cookie: j.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  j.take(res);
  return res;
}
const C = `http://127.0.0.1:${calPort}`;
const state = async () => (await fetch(`${C}/__state`)).json();
await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
await pool.query("delete from calendar_connections where user_id = $1", [priya.id]); // the seed's demo connections can't sync here
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots ?? [];
const conns = async () => (await pool.query("select id, status, account_email, last_synced_at from calendar_connections where user_id = $1 and provider = 'icloud'", [priya.id])).rows;
const GOOD = ["good", "pass", "1234"].join("-");

const pj = await signIn(priya.email);
let html = await (await get("/dashboard/calendars", pj)).text();
check(html.includes("Connect iCloud") && html.includes("App-specific password"), "calendars page offers iCloud");
let res = await submitForm(pj, "/dashboard/calendars", 'name="appleId"', { appleId: "priya@icloud.com", password: "wrong-pass-0000" });
check(res?.status === 200 && (await res.text()).includes("Apple didn&#x27;t accept that Apple ID"), "a wrong password is refused");
check((await conns()).length === 0, "and nothing is stored");
res = await submitForm(pj, "/dashboard/calendars", 'name="appleId"', { appleId: "Priya@iCloud.com", password: GOOD });
check(res?.status === 303, `the right password connects (${res?.status})`);
const [conn] = await conns();
check(conn?.account_email === "priya@icloud.com", "connection stored under the Apple ID");
const sealed = (await pool.query("select * from calendar_connections where id = $1", [conn?.id])).rows[0];
check(sealed && !JSON.stringify(sealed, (_k, v) => (v && v.type === "Buffer" ? Buffer.from(v.data).toString("latin1") : v)).includes(GOOD), "password stored sealed");
check(await waitFor(async () => Boolean((await conns())[0]?.last_synced_at), 60000), "first sync completes");
check((await pool.query("select is_add_to from calendars where connection_id = $1", [conn.id])).rows[0]?.is_add_to === true, "the iCloud calendar takes booked sessions");

let open = await slots();
check(open.length > 3, `slots offered after sync (${open.length})`);
const blocked = open[2];
await fetch(`${C}/__busy`, { method: "POST", body: JSON.stringify({ start: blocked, end: new Date(Date.parse(blocked) + 30 * 60_000).toISOString() }) });
await pool.query("update calendar_connections set next_sync_at = now() where id = $1", [conn.id]);
check(await waitFor(async () => !(await slots()).includes(blocked), 60000), "an iCloud busy event removes that slot");

open = await slots();
const book = async (start, key) => (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.88" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Cal Guest", email: "calguest@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: key }) })).json();
const b = await book(open.at(-1), `e2e-ical-${Date.now()}`);
const uid = `hourhand-${b.bookingId}`;
check(await waitFor(async () => Boolean((await state()).events[uid]), 60000), "a booking creates the iCloud event");
check(((await state()).events[uid] ?? "").includes("calguest@example.com"), "with the guest's details");

const token = (await pool.query("select manage_token from invitees where booking_id = $1", [b.bookingId])).rows[0].manage_token;
const target = open.at(-2);
res = await fetch(`${B}/api/b/${token}/reschedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: target, idempotencyKey: `e2e-ical-move-${Date.now()}` }) });
const moved = await res.json();
check(res.status === 201 || res.status === 200, `guest reschedules (${res.status})`);
const stamp = new Date(target).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
check(await waitFor(async () => ((await state()).events[uid] ?? "").includes(`DTSTART:${stamp}`), 60000), "the event moves to the new time");
check(((await state()).events[uid] ?? "").includes("calguest@example.com"), "and keeps the guest's details");

const token2 = (await pool.query("select manage_token from invitees where booking_id = $1", [moved.bookingId])).rows[0].manage_token;
res = await fetch(`${B}/api/b/${token2}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "" }) });
check(res.ok, `guest cancels (${res.status})`);
check(await waitFor(async () => !(await state()).events[uid], 60000), "the event is deleted");

await fetch(`${C}/__fail401`, { method: "POST" });
await pool.query("update calendar_connections set next_sync_at = now() where id = $1", [conn.id]);
check(await waitFor(async () => (await conns())[0]?.status === "disconnected", 60000), `a revoked password marks the connection for reconnect (${(await conns())[0]?.status})`);
check(!readFileSync(logPath, "utf8").includes(GOOD), "the password never reaches the server log");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
