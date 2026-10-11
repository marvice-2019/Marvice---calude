// B5b end to end against the local server and the fake host-side Razorpay only.
// Usage: node e2e/e2e-b5b.mjs <port> <server-log> <database-url> <rzp-port>
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
const ip = "203.0.113.90";

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
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) if (m[1].startsWith("$ACTION")) fd.append(m[1], m[2] ?? "");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(B + path, { method: "POST", body: fd, redirect: "manual", headers: { cookie: j.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  j.take(res);
  return res;
}

await sleep(2500);
check(log().includes("booking payments on"), "job runner started with booking payments on");
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const { rows: [arun] } = await pool.query("select id, email from users where slug = 'arun'");
// Priya pays for Solo (B5a covers the real subscription flow); Arun stays on Free.
await pool.query("insert into subscriptions (user_id, plan, interval, provider, provider_subscription_id, status, current_period_end) values ($1, 'solo', 'month', 'razorpay', 'sub_e2e', 'active', now() + interval '20 days')", [priya.id]);

// Connect Razorpay keys on the Integrations page
const pj = await signIn(priya.email);
let html = await (await get("/dashboard/integrations", pj)).text();
check(html.includes("Key ID") && html.includes("never holds your money"), "Integrations page offers to connect Razorpay");
let res = await submitForm(pj, "/dashboard/integrations", 'name="keyId"', { keyId: "rzp_test_e2ehost1234", keySecret: "wrong-value" });
check(res?.status === 303 && res.headers.get("location")?.includes("error=rejected"), `wrong key pair refused (${res?.status} ${res?.headers.get("location")})`);
check((await pool.query("select 1 from integrations where user_id = $1", [priya.id])).rowCount === 0, "…and nothing stored");
res = await submitForm(pj, "/dashboard/integrations", 'name="keyId"', { keyId: "rzp_test_e2ehost1234", keySecret: "e2e-host-key" });
check(res?.status === 303 && res.headers.get("location")?.includes("connected=1"), "right key pair connects");
const integ = (await pool.query("select public_id, mode, credentials_encrypted from integrations where user_id = $1 and provider = 'razorpay'", [priya.id])).rows[0];
check(integ?.mode === "test" && !Buffer.from(integ.credentials_encrypted).toString("latin1").includes("e2e-host-key"), "stored encrypted, test mode");
html = await (await get("/dashboard/integrations", pj)).text();
check(html.includes("rzp_test_••••1234") && html.includes("Test mode"), "page shows the masked key and Test mode");

// Price the coaching event (the editor saves through a client-side action, so set it directly here)
await pool.query("update event_types set price_minor = 49900, currency = 'INR' where user_id = $1 and slug = 'coaching'", [priya.id]);
check((await (await get("/priya/coaching")).text()).includes("₹499"), "booking page shows ₹499");

const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slotsNow = async () => (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const book = (start, email, key = `e2e-b5b-${Math.random()}`) => fetch(`${B}/api/bookings`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Kiran Rao", email, timezone: "Asia/Kolkata", answers, idempotencyKey: key }),
});
const confirmPay = (body) => fetch(`${B}/api/bookings/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: t() });
const bookingRow = async (id) => (await pool.query("select b.status, b.cancel_reason, p.status as pay_status from bookings b left join payments p on p.booking_id = b.id where b.id = $1", [id])).rows[0];

// 1. Pay and confirm
let slots = await slotsNow();
const s1 = slots.at(-1);
const g1 = `b5b-paid-${Date.now()}@example.com`;
res = await book(s1, g1);
const b1 = await res.json();
check(res.status === 201 && b1.payment?.keyId === "rzp_test_e2ehost1234" && b1.payment.amount === 49900 && b1.payment.orderId, `paid booking returns a Razorpay order (${res.status})`);
check((await bookingRow(b1.bookingId)).status === "pending_payment", "booking held, not confirmed");
check(!(await slotsNow()).includes(s1), "held time no longer offered");
res = await book(s1, `other-${Date.now()}@example.com`);
check(res.status === 409, `someone else can't book the held time (${res.status})`);
check(!log().includes(`[dev] email to ${g1}`), "no email before payment");
const paid1 = await (await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: b1.payment.orderId }) })).json();
res = await confirmPay({ manageToken: b1.manageToken, paymentId: paid1.razorpay_payment_id, signature: "0".repeat(64) });
check(res.status === 400 && (await res.json()).error === "bad_signature", "a forged signature is refused");
res = await confirmPay({ manageToken: b1.manageToken, paymentId: paid1.razorpay_payment_id, signature: paid1.razorpay_signature });
check(res.status === 200 && (await res.json()).status === "confirmed", "a real payment confirms the booking");
check((await bookingRow(b1.bookingId)).pay_status === "paid", "payment recorded as paid");
check(await waitFor(() => new RegExp(`\\[dev\\] email to ${g1.replace(/[.]/g, "\\.")}: Booked:[\\s\\S]*?₹499`).test(log())), "guest confirmation sent, showing ₹499");
check((await (await get(`/priya/coaching/booked/${b1.bookingId}`)).text()).includes("You're booked"), "booked page says booked");

// 2. Guest cancels: refund from the host's account, email says so
res = await fetch(`${B}/api/b/${b1.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Clash" }), signal: t() });
check(res.status === 200, `guest cancels (${res.status})`);
check(await waitFor(async () => (await bookingRow(b1.bookingId)).pay_status === "refunded"), "payment refunded by the job runner");
const refunds = Object.values((await fake()).refunds).filter((r) => r.payment_id === paid1.razorpay_payment_id);
check(refunds.length === 1 && refunds[0].amount === 49900, `one full refund at Razorpay (${refunds.length})`);
check(await waitFor(() => new RegExp(`\\[dev\\] email to ${g1.replace(/[.]/g, "\\.")}: Cancelled:[\\s\\S]*?is being refunded`).test(log())), "cancellation email says the ₹499 is being refunded");

// 3. Guest pays, closes the tab before the confirm call: the job runner confirms it
slots = await slotsNow();
const g3 = `b5b-tab-${Date.now()}@example.com`;
const b3 = await (await book(slots.at(-2), g3)).json();
await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: b3.payment.orderId }) });
await pool.query("update payments set created_at = now() - interval '2 minutes' where booking_id = $1", [b3.bookingId]);
check(await waitFor(async () => (await bookingRow(b3.bookingId)).status === "confirmed"), "paid-then-closed booking confirmed by the job runner");

// 4. Guest never pays: the hold lapses and the time is free again
slots = await slotsNow();
const s4 = slots.at(-3);
const b4 = await (await book(s4, `b5b-unpaid-${Date.now()}@example.com`)).json();
await pool.query("update payments set created_at = now() - interval '20 minutes' where booking_id = $1", [b4.bookingId]);
await pool.query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [b4.bookingId]);
check(await waitFor(async () => { const r = await bookingRow(b4.bookingId); return r.status === "cancelled" && r.pay_status === "pending"; }), "unpaid hold released; payment kept open for a late arrival");
check((await slotsNow()).includes(s4), "released time offered again");
check((await (await get(`/b/${b4.manageToken}`)).text()).includes("payment wasn't completed"), "manage page explains the payment wasn't completed");

// 5. A Free host can't take paid bookings even with a price set
await pool.query("update event_types set price_minor = 29900, currency = 'INR' where user_id = $1", [arun.id]);
const { rows: [ae] } = await pool.query("select slug from event_types where user_id = $1 order by position limit 1", [arun.id]);
const aq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = $1 and e.user_id = $2", [ae.slug, arun.id]);
const aslots = (await (await fetch(`${B}/api/slots?slug=arun&event=${ae.slug}&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots ?? [];
if (aslots.length) {
  res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json" }, signal: t(),
    body: JSON.stringify({ slug: "arun", event: ae.slug, start: aslots[0], name: "Asha", email: `asha-${Date.now()}@example.com`, timezone: "Asia/Kolkata", answers: Object.fromEntries(aq.rows.map((r) => [r.id, "x"])), idempotencyKey: `e2e-arun-${Date.now()}` }) });
  check(res.status === 409 && (await res.json()).error === "payments_unavailable", `Free host's priced event can't be booked (${res.status})`);
} else check(false, "Arun has no open slots to test with");

check(!/\[billing\].*failed|Unhandled|TypeError/.test(log()), "no payment errors in the server log");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
