// B-8 no-show deposit end to end against the local server and the fake host-side Razorpay.
// Usage: node e2e/e2e-deposit.mjs <port> <server-log> <database-url> <rzp-port>
import { readFileSync } from "node:fs";
import pg from "pg";

const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];
const [port, logPath, databaseUrl, rzpPort] = process.argv.slice(2);
const B = `http://localhost:${port}`;
const R = `http://127.0.0.1:${rzpPort}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
async function waitFor(pred, ms = 25000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(500); } return pred(); }
const fake = async () => (await fetch(`${R}/__state`)).json();
const ip = "203.0.113.92";

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
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
await pool.query("insert into subscriptions (user_id, plan, interval, provider, provider_subscription_id, status, current_period_end) values ($1, 'solo', 'month', 'razorpay', 'sub_e2e_dep', 'active', now() + interval '20 days')", [priya.id]);
const pj = await signIn(priya.email);
let res = await submitForm(pj, "/dashboard/integrations", 'name="keyId"', { keyId: "rzp_test_e2ehost1234", keySecret: "e2e-host-key" });
check(res?.status === 303, "Razorpay keys connected");
const { rows: [coaching] } = await pool.query("update event_types set deposit_minor = 20000 where user_id = $1 and slug = 'coaching' returning id", [priya.id]);
const page = await (await get("/priya/coaching")).text();
check(page.includes("₹200 refundable deposit"), "booking page explains the ₹200 refundable deposit");

const pq = await pool.query("select id from custom_questions where event_type_id = $1", [coaching.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const all = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${new Date().toISOString()}&to=${new Date(Date.now() + 14 * 864e5).toISOString()}&tz=Asia/Kolkata`)).json()).slots;
const slots = all.reduce((picked, s) => (picked.length === 0 || new Date(s) - new Date(picked.at(-1)) >= 864e5 ? [...picked, s] : picked), []);
const book = async (start, email) => (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Ravi Kumar", email, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-dep-${Math.random()}` }) })).json();
async function payFor(b) {
  const p = await (await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: b.payment.orderId }) })).json();
  return fetch(`${B}/api/bookings/pay`, { method: "POST", headers: { "content-type": "application/json" }, signal: t(),
    body: JSON.stringify({ manageToken: b.manageToken, paymentId: p.razorpay_payment_id, signature: p.razorpay_signature }) });
}
const showed = await book(slots[0], `dep-show-${Date.now()}@example.com`);
check(showed.payment?.amount === 20000, "booking asks for the ₹200 deposit");
check((await payFor(showed)).status === 200, "deposit paid, booking confirmed");
const noShow = await book(slots[1], `dep-noshow-${Date.now()}@example.com`);
await payFor(noShow);
const kinds = (await pool.query("select kind, status from payments where booking_id = any($1)", [[showed.bookingId, noShow.bookingId]])).rows;
check(kinds.length === 2 && kinds.every((k) => k.kind === "deposit" && k.status === "paid"), "both recorded as paid deposits");

// Both sessions end over a day ago (moved back in time, at night, clear of other bookings); one is marked a no-show.
const back = async (id, days) => pool.query(
  `update bookings set start_at = date_trunc('day', now()) - interval '${days} days' + interval '20 hours', end_at = date_trunc('day', now()) - interval '${days} days' + interval '20 hours 45 minutes',
     buffered_start = date_trunc('day', now()) - interval '${days} days' + interval '19 hours 50 minutes', buffered_end = date_trunc('day', now()) - interval '${days} days' + interval '20 hours 55 minutes' where id = $1`, [id]);
// Mark the no-show before moving it back, or the job runner can refund it in between.
await pool.query("update invitees set no_show_at = now() where booking_id = $1", [noShow.bookingId]);
await back(showed.bookingId, 3);
await back(noShow.bookingId, 4);
const status = async (id) => (await pool.query("select status from payments where booking_id = $1", [id])).rows[0].status;
check(await waitFor(async () => (await status(showed.bookingId)) === "refunded", 60000), "the guest who came gets the deposit back (job runner)");
const refunds = Object.values((await fake()).refunds);
check(refunds.length === 1 && refunds[0].amount === 20000, `one ₹200 refund at Razorpay (${refunds.length})`);
check((await status(noShow.bookingId)) === "paid", "the no-show's deposit is kept");
const hostPage = await (await get(`/dashboard/bookings/${noShow.bookingId}`, pj)).text();
check(hostPage.includes("kept for the no-show"), "host's booking page says the deposit was kept");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
