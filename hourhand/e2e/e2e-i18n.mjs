// C-11 guest pages in Indian languages. Usage: node e2e/e2e-i18n.mjs <port> <server-log> <database-url>
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
const { CATALOGS } = await import("../src/lib/i18n/guest.ts");
// Text as React renders it: apostrophes become &#x27;.
const has = (html, locale, key) => html.includes(CATALOGS[locale][key].replace(/\{\w+\}.*$/, "").replace(/'/g, "&#x27;").trim());
await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");

let html = await (await get("/priya")).text();
check(has(html, "en", "seeTimes") && html.includes('lang="en"'), "with no setting the page is English");

const pj = await signIn(priya.email);
let res = await submitForm(pj, "/dashboard/settings", 'name="locale"', { locale: "ta" });
check(res?.status === 303 && (await pool.query("select locale from users where id = $1", [priya.id])).rows[0].locale === "ta", `host sets Tamil (${res?.status})`);
res = await submitForm(pj, "/dashboard/settings", 'name="locale"', { locale: "xx" });
check((await pool.query("select locale from users where id = $1", [priya.id])).rows[0].locale === "ta", "an unknown language isn't saved");

html = await (await get("/priya")).text();
check(html.includes('lang="ta"') && has(html, "ta", "seeTimes") && has(html, "ta", "pickService"), "public page in Tamil");
check(html.includes("தமிழ்") && html.includes("हिन्दी") && html.includes("?lang=hi"), "language switcher offered");
html = await (await get("/priya/coaching")).text();
check(html.includes('lang="ta"') && has(html, "ta", "privacy") && has(html, "ta", "language"), "booking page in Tamil");
html = await (await get("/priya/coaching?lang=hi")).text();
check(html.includes('lang="hi"') && html.includes('href="/priya?lang=hi"'), "?lang=hi shows Hindi and keeps it on links");
html = await (await get("/priya/coaching?lang=xx")).text();
check(html.includes('lang="ta"'), "an invalid ?lang falls back to the host's language");

const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const booked = await (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: slots.at(-1), name: "Lang Guest", email: "lang@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-i18n-${Date.now()}` }) })).json();
check(Boolean(booked.bookingId), "guest books");
html = await (await get(`/priya/coaching/booked/${booked.bookingId}?lang=hi`)).text();
check(html.includes('lang="hi"') && has(html, "hi", "booked") && html.includes("?lang=hi"), "confirmation in Hindi, manage link keeps it");
const token = (await pool.query("select manage_token from invitees where booking_id = $1", [booked.bookingId])).rows[0].manage_token;
html = await (await get(`/b/${token}?lang=te`)).text();
check(html.includes('lang="te"') && has(html, "te", "yourBooking"), "manage page in Telugu");
html = await (await get(`/b/${token}`)).text();
check(html.includes('lang="ta"'), "manage page defaults to the host's language");
html = await (await get("/arun")).text();
check(html.includes('lang="en"') && has(html, "en", "seeTimes"), "another host stays English");

const hiBooking = await (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.78" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: slots[0], name: "Hindi Guest", email: "higuest@example.com", timezone: "Asia/Kolkata", answers, locale: "hi", idempotencyKey: `e2e-i18n-hi-${Date.now()}` }) })).json();
check(Boolean(hiBooking.bookingId), `a guest books from the Hindi page (${JSON.stringify(hiBooking).slice(0, 160)})`);
check(await waitFor(() => /\[dev\] email to higuest@example\.com: बुक हो गया: /.test(log())), "their confirmation email is in Hindi");
check(await waitFor(() => /\[dev\] email to priya@example\.in: New booking: Hindi Guest/.test(log()) || log().includes("New booking: Hindi Guest")), "the host's own email stays English");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
