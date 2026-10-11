// B-7 GST invoices end to end against the local server and the fake host-side Razorpay.
// Usage: node e2e/e2e-gst.mjs <port> <server-log> <database-url> <rzp-port>
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
const ip = "203.0.113.93";

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
await pool.query("insert into subscriptions (user_id, plan, interval, provider, provider_subscription_id, status, current_period_end) values ($1, 'solo', 'month', 'razorpay', 'sub_e2e_gst', 'active', now() + interval '20 days')", [priya.id]);
const pj = await signIn(priya.email);
let res = await submitForm(pj, "/dashboard/integrations", 'name="keyId"', { keyId: "rzp_test_e2ehost1234", keySecret: "e2e-host-key" });
check(res?.status === 303, "Razorpay keys connected");

// GSTIN with a valid check character (computed the same way the app does).
const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const check14 = (s) => { let sum = 0; for (let i = 0; i < 14; i++) { const p = CH.indexOf(s[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); } return CH[(36 - (sum % 36)) % 36]; };
const gstin = "29AAPFU0939F1Z" + check14("29AAPFU0939F1Z");
res = await submitForm(pj, "/dashboard/invoices", 'name="gstin"', { legalName: "Priya Sharma Coaching LLP", address: "12 MG Road, Bengaluru 560001", gstin: "29AAPFU0939F1ZA", sac: "999293", rate: "18", invoicePrefix: "PRS" });
check(!(await pool.query("select 1 from tax_profiles where user_id = $1", [priya.id])).rowCount, "a GSTIN with a wrong check character isn't saved");
res = await submitForm(pj, "/dashboard/invoices", 'name="gstin"', { legalName: "Priya Sharma Coaching LLP", address: "12 MG Road, Bengaluru 560001", gstin, sac: "999293", rate: "18", invoicePrefix: "PRS" });
check((await pool.query("select state_code from tax_profiles where user_id = $1", [priya.id])).rows[0]?.state_code === "29", "GST details saved, state Karnataka from the GSTIN");

await pool.query("update event_types set price_minor = 49900, currency = 'INR' where user_id = $1 and slug = 'coaching'", [priya.id]);
const { rows: [coaching] } = await pool.query("select id from event_types where user_id = $1 and slug = 'coaching'", [priya.id]);
const pq = await pool.query("select id from custom_questions where event_type_id = $1", [coaching.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const slots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${new Date().toISOString()}&to=${new Date(Date.now() + 14 * 864e5).toISOString()}&tz=Asia/Kolkata`)).json()).slots;
const email = `gst-guest-${Date.now()}@example.com`;
const b = await (await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: slots.at(-1), name: "Asha Rao", email, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-gst-${Date.now()}` }) })).json();
const p = await (await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: b.payment.orderId }) })).json();
res = await fetch(`${B}/api/bookings/pay`, { method: "POST", headers: { "content-type": "application/json" }, signal: t(),
  body: JSON.stringify({ manageToken: b.manageToken, paymentId: p.razorpay_payment_id, signature: p.razorpay_signature }) });
check(res.status === 200, "booking paid");
const { rows: [inv] } = await pool.query("select v.number, v.token from invoices v join payments y on y.id = v.payment_id where y.booking_id = $1 and v.kind = 'invoice'", [b.bookingId]);
check(/^PRS\/\d{4}\/000001$/.test(inv?.number ?? ""), `invoice issued: ${inv?.number}`);
check(await waitFor(() => log().includes(`[dev] email to ${email}: Invoice ${inv.number}`) && log().includes(`/invoice/${inv.token}`)), "guest emailed the invoice link");
let html = await (await get(`/invoice/${inv.token}`)).text();
for (const s of ["Tax invoice", gstin, "Priya Sharma Coaching LLP", "999293", "29 Karnataka", "₹422.88", "CGST 9%", "₹38.06", "Total paid", "₹499"]) check(html.includes(s), `invoice page shows ${s}`);
check((await get(`/invoice/${"0".repeat(48)}`)).status === 404, "unknown invoice link is 404");

res = await fetch(`${B}/api/b/${b.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: t() });
check(await waitFor(async () => (await pool.query("select number from invoices where kind = 'credit_note' and host_id = $1", [priya.id])).rowCount === 1, 60000), "refund issues a credit note");
const { rows: [cn] } = await pool.query("select number, token from invoices where kind = 'credit_note' and host_id = $1", [priya.id]);
html = await (await get(`/invoice/${cn.token}`)).text();
check(html.includes("Credit note") && html.includes(`Against invoice ${inv.number}`) && html.includes("Total refunded"), `credit note page (${cn.number})`);

html = await (await get("/dashboard/invoices", pj)).text();
check(html.includes(inv.number) && html.includes(cn.number), "host sees both on the Invoices page");
const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
res = await get(`/dashboard/invoices/export?month=${month}`, pj);
const csv = await res.text();
check(res.status === 200 && csv.includes(`Invoice,${inv.number}`) && csv.includes(`Credit note,${cn.number}`) && csv.includes(",-499.00"), "CSV export has both, credit note negative");
check((await get(`/dashboard/invoices/export?month=${month}`)).status === 401, "CSV export needs sign-in");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
