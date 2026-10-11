// D1 add to calendar and redirect after booking. Usage: node e2e/e2e-d1.mjs <port> <server-log> <database-url>
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
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const book = async (start) => (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.61" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Cal Guest", email: "d1guest@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-d1-${start}` }) })).json();

const b = await book(slots.at(-1));
check(Boolean(b.bookingId), "guest books");
const token = (await pool.query("select manage_token from invitees where booking_id = $1", [b.bookingId])).rows[0].manage_token;
let html = await (await get(`/priya/coaching/booked/${b.bookingId}`)).text();
check(html.includes("https://calendar.google.com/calendar/render?action=TEMPLATE") && html.includes("https://outlook.live.com/calendar/0/action/compose?"), "confirmation offers Google and Outlook");
check(html.includes(`href="/b/${token}/calendar.ics"`), "and the .ics file");
check(!html.includes("Taking you there"), "no redirect when the host hasn't set one");
const start = new Date(slots.at(-1)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
check(html.includes(`dates=${start}%2F`), "Google link carries the booked start time");

const ics = await get(`/b/${token}/calendar.ics`);
const body = await ics.text();
check(ics.status === 200 && ics.headers.get("content-type")?.startsWith("text/calendar"), `.ics served as a calendar (${ics.status})`);
check(body.includes(`UID:${b.bookingId}@hourhand`) && body.includes(`DTSTART:${start}`), ".ics has the booking's UID and time");
check((await get(`/b/not-a-real-token/calendar.ics`)).status === 404, "an unknown token gets no file");

html = await (await get(`/b/${token}?lang=ta`)).text();
check(html.includes("காலெண்டரில் சேர்க்கவும்"), "manage page offers it too, in the guest's language");

await pool.query("update event_types set redirect_url = 'https://priya.coach/thanks' where slug = 'coaching' and user_id = $1", [priya.id]);
html = await (await get(`/priya/coaching/booked/${b.bookingId}`)).text();
check(html.includes('href="https://priya.coach/thanks"') && html.includes("Continue to priya.coach"), "with a redirect set, the confirmation sends the guest on");

await fetch(`${B}/api/b/${token}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "" }) });
check((await get(`/b/${token}/calendar.ics`)).status === 404, "no .ics for a cancelled booking");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
