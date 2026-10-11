// C-9 waitlist end to end. Usage: node e2e/e2e-waitlist.mjs <port> <server-log> <database-url>
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
    body: JSON.stringify({ slug: "priya", event: "coaching", start: s.at(-1), name: "Kiran Rao", email, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-wl-${Math.random()}` }) });
  return res.json();
}

const pj = await signIn(priya.email);
const b = await book(`wl-booked-${Date.now()}@example.com`);
const start = (await pool.query("select start_at from bookings where id = $1", [b.bookingId])).rows[0].start_at;
const day = new Date(start.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const join = (body) => fetch(`${B}/api/waitlist`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, signal: t(), body: JSON.stringify(body) });
const wl = `wl-wait-${Date.now()}@example.com`;
const body = { slug: "priya", event: "coaching", day, timezone: "Asia/Kolkata", name: "Waiting Guest", email: wl };
let res = await join(body);
check(res.status === 200, `guest joins the waitlist for ${day} (${res.status})`);
check((await join({ ...body, day: "2001-01-01" })).status === 400, "a past day is refused");
check((await join({ ...body, event: "nope" })).status === 404, "an unknown event type is 404");
check((await pool.query("select count(*)::int as n from waitlist where email = $1", [wl])).rows[0].n === 1, "one waitlist entry stored");

res = await submit(pj, `/dashboard/bookings/${b.bookingId}?confirm=cancel`, "Yes, cancel", { reason: "Away" });
check(res?.status === 303, `host cancels the booking (${res?.status})`);
const re = new RegExp(`\\[dev\\] email to ${wl.replace(/[.]/g, "\\.")}: A time opened up with [^\\n]+\\n[\\s\\S]*?(https?://\\S+/priya/coaching\\?at=\\S+)`);
check(await waitFor(() => re.test(log())), "waiting guest emailed that a time opened");
const link = re.exec(log())?.[1] ?? "";
check(decodeURIComponent(link).includes(start.toISOString()), "the email links straight to the freed time");
const page = await get(link.replace(/^https?:\/\/[^/]+/, ""));
check(page.status === 200, "the link opens the booking page");
check((await pool.query("select notified_at is not null as n from waitlist where email = $1", [wl])).rows[0].n, "entry marked notified, so it is emailed once");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
