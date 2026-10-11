// B7 end to end: the host cancels, moves and marks no-shows from the dashboard. Usage: node e2e/e2e-b7.mjs <port> <server-log> <database-url>
import { readFileSync } from "node:fs";
import pg from "pg";

const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];
const [port, logPath, databaseUrl] = process.argv.slice(2);
const B = `http://localhost:${port}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
async function waitFor(pred, ms = 12000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(300); } return pred(); }
const ip = "203.0.113.95";

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
  res.text = async () => (await text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
  return res;
};
async function signIn(email) {
  await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": ip }, body: JSON.stringify({ email, callbackURL: "/dashboard" }), signal: t() });
  await sleep(300);
  const j = jar();
  await get(lastLink(log(), email).replace(/^https?:\/\/[^/]+/, ""), j);
  return j;
}
/** Posts the no-JS form on `path` whose markup contains `marker`, with its hidden inputs plus `fields`. */
async function submit(j, path, marker, fields = {}) {
  const html = await (await get(path, j)).text();
  const form = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(marker));
  if (!form) return null;
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) fd.append(m[1], m[2] ?? "");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(B + path, { method: "POST", body: fd, redirect: "manual", headers: { cookie: j.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  j.take(res);
  return res;
}

await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const { rows: [arun] } = await pool.query("select id, email from users where slug = 'arun'");
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
async function book(email) {
  const s = await slots();
  const res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, signal: t(),
    body: JSON.stringify({ slug: "priya", event: "coaching", start: s.at(-1), name: "Kiran Rao", email, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-b7-${Math.random()}` }) });
  return res.json();
}
const row = async (id) => (await pool.query("select status, cancelled_by, cancel_reason, start_at from bookings where id = $1", [id])).rows[0];

const pj = await signIn(priya.email);

// Cancel, with a confirm step and a reason
const g1 = `b7-cancel-${Date.now()}@example.com`;
const b1 = await book(g1);
let html = await (await get(`/dashboard/bookings/${b1.bookingId}`, pj)).text();
check(html.includes("Cancel") && html.includes("Move"), `detail page offers cancel and move`);
html = await (await get(`/dashboard/bookings/${b1.bookingId}?confirm=cancel`, pj)).text();
check(html.includes("Yes, cancel"), "cancel asks for confirmation first");
let res = await submit(pj, `/dashboard/bookings/${b1.bookingId}?confirm=cancel`, "Yes, cancel", { reason: "Unwell today" });
check(res?.status === 303, `confirm cancel redirects (${res?.status} ${res?.headers.get("location")})`);
const r1 = await row(b1.bookingId);
check(r1.status === "cancelled" && r1.cancelled_by === "host" && r1.cancel_reason === "Unwell today", "booking cancelled by the host with the reason");
check(await waitFor(() => new RegExp(`\\[dev\\] email to ${g1.replace(/[.]/g, "\\.")}: Cancelled:[\\s\\S]*?cancelled your booking`).test(log())), "guest emailed that the host cancelled");

// Move to another free time
const g2 = `b7-move-${Date.now()}@example.com`;
const b2 = await book(g2);
const before = (await row(b2.bookingId)).start_at.getTime();
html = await (await get(`/dashboard/bookings/${b2.bookingId}?reschedule=1`, pj)).text();
const times = [...html.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]).filter((s) => new Date(s).getTime() !== before);
check(times.length > 0, `move page lists free times (${times.length})`);
res = await submit(pj, `/dashboard/bookings/${b2.bookingId}?reschedule=1`, `value="${times[0]}"`);
check(res?.status === 303 && (res.headers.get("location") ?? "").includes("done=rescheduled"), `move redirects to the new booking (${res?.headers.get("location")})`);
const old2 = await row(b2.bookingId);
const { rows: [moved] } = await pool.query("select id, start_at, status from bookings where rescheduled_from_id = $1", [b2.bookingId]);
check(old2.status === "cancelled" && old2.cancelled_by === "host" && moved?.status === "confirmed" && moved.start_at.toISOString() === times[0], "old booking cancelled by the host, new one confirmed at the chosen time");
check(await waitFor(() => new RegExp(`\\[dev\\] email to ${g2.replace(/[.]/g, "\\.")}: Moved:`).test(log())), "guest emailed the new time");

// No-show, only once the booking has started
await pool.query("update bookings set start_at = now() - interval '2 hours', end_at = now() - interval '90 minutes', buffered_start = now() - interval '2 hours', buffered_end = now() - interval '90 minutes' where id = $1", [moved.id]);
res = await submit(pj, `/dashboard/bookings/${moved.id}`, "Mark as no-show");
check(res?.status === 303, `mark no-show (${res?.status})`);
check((await pool.query("select no_show_at from invitees where booking_id = $1", [moved.id])).rows[0].no_show_at !== null, "no-show recorded");
html = await (await get(`/dashboard/bookings/${moved.id}`, pj)).text();
check(html.includes("Undo no-show") && html.includes("No-show"), "detail page shows the no-show and offers undo");
check((await (await get("/dashboard/bookings", pj)).text()).includes("No-show"), "bookings list shows the no-show");
res = await submit(pj, `/dashboard/bookings/${moved.id}`, "Undo no-show");
check((await pool.query("select no_show_at from invitees where booking_id = $1", [moved.id])).rows[0].no_show_at === null, "no-show undone");

// Another host can't see or act on it
const aj = await signIn(arun.email);
const other = await get(`/dashboard/bookings/${moved.id}`, aj);
check(other.status === 404 || (await other.text()).includes("could not be found"), `another host gets not found (${other.status})`);

check(!/Unhandled|TypeError/.test(log()), "no errors in the server log");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
