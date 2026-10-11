// B-3 packages end to end against the local server and the fake host-side Razorpay.
// Usage: node e2e/e2e-packages.mjs <port> <server-log> <database-url> <rzp-port>
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
const ip = "203.0.113.91";

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
await pool.query("insert into subscriptions (user_id, plan, interval, provider, provider_subscription_id, status, current_period_end) values ($1, 'solo', 'month', 'razorpay', 'sub_e2e_pkg', 'active', now() + interval '20 days')", [priya.id]);
const pj = await signIn(priya.email);
let res = await submitForm(pj, "/dashboard/integrations", 'name="keyId"', { keyId: "rzp_test_e2ehost1234", keySecret: "e2e-host-key" });
check(res?.status === 303, "Razorpay keys connected");
const { rows: [coaching] } = await pool.query("select id from event_types where user_id = $1 and slug = 'coaching'", [priya.id]);

let html = await (await get("/dashboard/packages", pj)).text();
check(html.includes("New package") && html.includes("No sales yet"), "Packages page loads, empty");
res = await submitForm(pj, "/dashboard/packages", 'name="sessions"', { eventTypeId: coaching.id, name: "2 coaching sessions", sessions: "2", price: "999", validDays: "30" });
const { rows: [pkg] } = await pool.query("select id, price_minor from packages where user_id = $1", [priya.id]);
check(pkg?.price_minor === 99900, `package created at ₹999 (${res?.status})`);
check((await (await get("/priya/coaching")).text()).includes("Save with 2 sessions for ₹999"), "booking page offers the package");
check((await (await get(`/pkg/${pkg.id}`)).text()).includes("2 coaching sessions"), "buy page shows the package");

const buy = async (email, key) => (await fetch(`${B}/api/packages/${pkg.id}/buy`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, signal: t(),
  body: JSON.stringify({ name: "Kavya Nair", email, idempotencyKey: key }) })).json();
const email = `pkg-buyer-${Date.now()}@example.com`;
const started = await buy(email, `e2e-pkg-${Date.now()}`);
check(started.payment?.amount === 99900 && started.payment.keyId === "rzp_test_e2ehost1234", "purchase opens a ₹999 Razorpay order on the host's account");
const paid = await (await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: started.payment.orderId }) })).json();
res = await fetch(`${B}/api/packages/pay`, { method: "POST", headers: { "content-type": "application/json" }, signal: t(),
  body: JSON.stringify({ token: started.token, paymentId: paid.razorpay_payment_id, signature: "0".repeat(64) }) });
check(res.status === 400, "forged signature refused");
res = await fetch(`${B}/api/packages/pay`, { method: "POST", headers: { "content-type": "application/json" }, signal: t(),
  body: JSON.stringify({ token: started.token, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature }) });
check(res.status === 200 && (await res.json()).status === "paid", "real payment marks it paid");
check(await waitFor(() => log().includes(`[dev] email to ${email}`) && log().includes(`/p/${started.token}`)), "buyer emailed their private link");
html = await (await get(`/p/${started.token}`)).text();
check(html.includes("2 of 2") && html.includes("Book a session"), "buyer page: 2 of 2 left, booking open");

const pq = await pool.query("select q.id from custom_questions q where q.event_type_id = $1", [coaching.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const allSlots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${new Date().toISOString()}&to=${new Date(Date.now() + 14 * 864e5).toISOString()}&tz=Asia/Kolkata`)).json()).slots;
// A day apart, so one booking's buffers never cover the next.
const slots = allSlots.filter((s, i, all) => i === 0 || new Date(s) - new Date(all[0]) >= 0).reduce((picked, s) => (picked.length === 0 || new Date(s) - new Date(picked.at(-1)) >= 864e5 ? [...picked, s] : picked), []);
const bookWith = (start) => fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Kavya Nair", email, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-pkg-b-${Math.random()}`, packageToken: started.token }) });
const one = await (await bookWith(slots[0])).json();
res = await bookWith(slots[1]);
check(res.status === 201, `second session booked (${res.status} ${res.status !== 201 ? JSON.stringify(await res.clone().json()) : ""})`);
res = await bookWith(slots[2]);
check(res.status === 409 && (await res.json()).error === "package_used_up", "third session refused: package used up");
res = await fetch(`${B}/api/b/${one.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: t() });
html = await (await get(`/p/${started.token}`)).text();
check(res.status === 200 && html.includes("1 of 2"), "a cancelled session goes back: 1 of 2 left");
html = await (await get("/dashboard/packages", pj)).text();
check(html.includes("Kavya Nair") && html.includes("1 of 2"), "host sees the sale and its use");

// Paid, then the tab closed before confirming: the job runner settles it.
const tab = await buy(`pkg-tab-${Date.now()}@example.com`, `e2e-pkg-tab-${Date.now()}`);
await fetch(`${R}/__pay`, { method: "POST", body: JSON.stringify({ orderId: tab.payment.orderId }) });
await pool.query("update package_purchases set created_at = now() - interval '2 minutes' where token = $1", [tab.token]);
check(await waitFor(async () => (await pool.query("select status from package_purchases where token = $1", [tab.token])).rows[0].status === "paid", 60000), "closed-tab purchase paid by the job runner");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
