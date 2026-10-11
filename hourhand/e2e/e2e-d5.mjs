// D5 cancellation policy and weekly limit. Usage: node e2e/e2e-d5.mjs <port> <server-log> <database-url>
// Usage: node e2e/e2e-clients.mjs <port> <server-log> <database-url> <rzp-port>
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
await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id from users where slug = 'priya'");
await pool.query("update event_types set cancellation_policy = 'Free to cancel up to 24 hours before.', weekly_limit = 1 where slug = 'coaching' and user_id = $1", [priya.id]);
// Clear the seed's coaching bookings so the weekly count starts at zero.
await pool.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'host' where host_id = $1 and event_type_id = (select id from event_types where slug = 'coaching' and user_id = $1) and status = 'confirmed'", [priya.id]);
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
let html = await (await get("/priya/coaching")).text();
check(html.includes("Cancellation policy") && html.includes("Free to cancel up to 24 hours before."), "the policy shows before booking");
html = await (await get("/priya/coaching?lang=hi")).text();
check(html.includes("रद्द करने की नीति"), "with its heading in the guest's language");

const from = new Date().toISOString(), to = new Date(Date.now() + 21 * 864e5).toISOString();
const slots = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const before = await slots();
const first = before[0];
const weekStart = (iso) => { const d = new Date(new Date(iso).getTime() + 330 * 60_000); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) - 330 * 60_000).getTime(); };
const sameWeek = (iso) => weekStart(iso) === weekStart(first);
check(before.filter(sameWeek).length > 1, `several times offered that week before booking (${before.filter(sameWeek).length})`);
const b = await (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.65" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: first, name: "Week Guest", email: "d5guest@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-d5-${Date.now()}` }) })).json();
check(Boolean(b.bookingId), "a guest books one");
const after = await slots();
check(after.filter(sameWeek).length === 0, "with a weekly limit of 1, the rest of that week closes");
check(after.some((s) => !sameWeek(s)), "the next week is still open");
const res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.66" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: before.filter(sameWeek).at(-1), name: "Second", email: "d5second@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-d5b-${Date.now()}` }) });
check(res.status === 409, `booking that week anyway is refused (${res.status})`);
const token = (await pool.query("select manage_token from invitees where booking_id = $1", [b.bookingId])).rows[0].manage_token;
html = await (await get(`/b/${token}`)).text();
check(html.includes("Free to cancel up to 24 hours before."), "the manage page shows the policy next to Cancel");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
