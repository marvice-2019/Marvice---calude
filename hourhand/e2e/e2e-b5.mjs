// B5a end to end against the local server and the fake Razorpay/Stripe only.
// Usage: node e2e/e2e-b5.mjs <port> <server-log> <database-url> <rzp-port> <stripe-port>
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];
const [port, logPath, databaseUrl, rzpPort, stripePort] = process.argv.slice(2);
const B = `http://localhost:${port}`;
const R = `http://127.0.0.1:${rzpPort}`, S = `http://127.0.0.1:${stripePort}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => readFileSync(logPath, "utf8");
const fake = async () => (await fetch(`${R}/__state`)).json();
const setSub = (provider, sub) => fetch(`${R}/__set`, { method: "POST", body: JSON.stringify({ provider, sub }) });

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
const ip = "203.0.113.80";
const get = async (path, j) => {
  const res = await fetch(B + path, { redirect: "manual", headers: { "x-forwarded-for": ip, ...(j ? { cookie: j.header() } : {}) }, signal: t() });
  j?.take(res);
  // React separates adjacent text with <!-- -->; drop it so checks read the text as shown.
  const text = res.text.bind(res);
  res.text = async () => (await text()).replace(/<!-- -->/g, "");
  return res;
};
async function signIn(email) {
  await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": ip }, body: JSON.stringify({ email, callbackURL: "/dashboard/plan" }), signal: t() });
  await sleep(300);
  const j = jar();
  await get(lastLink(log(), email).replace(/^https?:\/\/[^/]+/, ""), j);
  return j;
}
/** Submits the no-JavaScript form whose fields include all of `match`, as a browser without JS would. */
async function submit(j, path, match) {
  const html = await (await get(path, j)).text();
  const forms = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]);
  const form = forms.find((f) => Object.entries(match).every(([k, v]) => f.includes(`name="${k}" value="${v}"`)));
  if (!form) return null;
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) fd.append(m[1].replace(/&amp;/g, "&"), (m[2] ?? "").replace(/&amp;/g, "&"));
  const res = await fetch(B + path, { method: "POST", body: fd, redirect: "manual", headers: { cookie: j.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  j.take(res);
  return res;
}
const rzpHook = (body, opts = {}) => {
  const raw = JSON.stringify(body);
  return fetch(`${B}/api/webhooks/razorpay`, { method: "POST", body: raw, signal: t(), headers: {
    "content-type": "application/json", "x-razorpay-event-id": opts.id ?? `evt_${Math.random()}`,
    "x-razorpay-signature": createHmac("sha256", opts.key ?? "e2e-rzp-hook").update(raw).digest("hex") } });
};
const stripeHook = (body, ts = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify(body);
  return fetch(`${B}/api/webhooks/stripe`, { method: "POST", body: raw, signal: t(), headers: {
    "content-type": "application/json", "stripe-signature": `t=${ts},v1=${createHmac("sha256", "e2e-stripe-hook").update(`${ts}.${raw}`).digest("hex")}` } });
};

await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const { rows: [arun] } = await pool.query("select id, email from users where slug = 'arun'");
const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;

// Free plan: footer on the booking page, plan page offers INR plans with GST shown
check((await (await get("/priya")).text()).includes("Booked with"), "Free host's booking page shows the Hourhand footer");
const pj = await signIn(priya.email);
let html = await (await get("/dashboard/plan", pj)).text();
check(html.includes("Current plan: Free") && html.includes("₹399 + 18% GST = ₹470.82 a month") && html.includes("Choose Solo"), "plan page: Free, INR price with GST, Choose Solo");
html = await (await get("/dashboard/plan?currency=USD&interval=year", pj)).text();
check(html.includes("$70 a year"), "plan page: USD yearly price");

// Razorpay checkout
let res = await submit(pj, "/dashboard/plan", { plan: "solo", currency: "INR", interval: "month" });
check(res && res.status === 303 && res.headers.get("location") === "https://rzp.io/i/fake1", `Choose Solo sends the host to Razorpay's payment link (${res?.status} ${res?.headers.get("location")})`);
const create = (await fake()).calls.find((c) => c.provider === "razorpay" && c.path === "/v1/subscriptions");
check(create && JSON.parse(create.body).plan_id === "plan_solo_m" && JSON.parse(create.body).notes.user_id === priya.id, "Razorpay subscription created for plan_solo_m with the host in its notes");

// Webhooks
await setSub("rzp", { id: "sub_rzp_1", plan_id: "plan_solo_m", status: "active", current_end: periodEnd, customer_id: "cust_1", notes: { user_id: priya.id } });
const activated = { event: "subscription.activated", payload: { subscription: { entity: { id: "sub_rzp_1", status: "active" } } } };
check((await rzpHook(activated, { key: "wrong" })).status === 400, "Razorpay webhook with a bad signature is refused (400)");
check((await pool.query("select 1 from subscriptions where user_id = $1", [priya.id])).rowCount === 0, "…and grants nothing");
res = await rzpHook(activated, { id: "evt_act_1" });
check(res.status === 200 && (await res.json()).outcome === "processed", "signed Razorpay webhook processed (200)");
res = await rzpHook(activated, { id: "evt_act_1" });
check(res.status === 200 && (await res.json()).outcome === "duplicate", "the same event again is acknowledged as a duplicate");
html = await (await get("/dashboard/plan", pj)).text();
check(html.includes("Current plan: Solo") && html.includes("Renews"), "plan page now shows Solo and the renewal date");
check(!(await (await get("/priya")).text()).includes("Booked with"), "Solo host's booking page has no footer");
res = await submit(pj, "/dashboard/plan?currency=INR", { plan: "duo", currency: "INR", interval: "month" });
check(res === null, "no plan cards while subscribed, so no second checkout");

// Pause, resume, cancel
const pauseForm = async (label) => {
  const page = await (await get("/dashboard/plan", pj)).text();
  return page.includes(label);
};
check(await pauseForm("Pause billing") && await pauseForm("Cancel renewal"), "active plan offers pause and cancel");
const submitByButton = async (label) => {
  const page = await (await get("/dashboard/plan", pj)).text();
  const form = [...page.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(`>${label}<`));
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) fd.append(m[1], m[2] ?? "");
  const r = await fetch(`${B}/dashboard/plan`, { method: "POST", body: fd, redirect: "manual", headers: { cookie: pj.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  return r;
};
res = await submitByButton("Pause billing");
check(res.status === 303 && res.headers.get("location")?.includes("done=paused"), "pause redirects back with done=paused");
check((await pool.query("select status from subscriptions where user_id = $1", [priya.id])).rows[0].status === "paused", "pause re-read from Razorpay: status paused");
check((await (await get("/priya")).text()).includes("Booked with"), "paused host's booking page shows the footer again (Free features)");
res = await submitByButton("Resume");
check((await pool.query("select status from subscriptions where user_id = $1", [priya.id])).rows[0].status === "active", "resume: status active");
res = await submitByButton("Cancel renewal");
const calls = (await fake()).calls.map((c) => c.path);
check(calls.includes("/v1/subscriptions/sub_rzp_1/cancel"), "cancel called Razorpay's cancel endpoint");
html = await (await get("/dashboard/plan", pj)).text();
check(html.includes("Cancelled. Your plan stays on until"), "plan page: cancelled, plan stays until period end");

// Stripe, for Arun
const aj = await signIn(arun.email);
res = await submit(aj, "/dashboard/plan?currency=USD&interval=year", { plan: "duo", currency: "USD", interval: "year" });
check(res && res.status === 303 && res.headers.get("location") === "https://checkout.stripe.com/c/pay/cs_fake", "USD checkout sends the host to Stripe Checkout");
const cs = (await fake()).calls.find((c) => c.path === "/v1/checkout/sessions");
const csf = new URLSearchParams(cs.body);
check(csf.get("line_items[0][price]") === "price_duo_y" && csf.get("subscription_data[metadata][user_id]") === arun.id && cs.idem?.startsWith(`checkout:${arun.id}:`), "Stripe checkout: duo yearly price, host in metadata, idempotency key");
await setSub("stripe", { id: "sub_st_1", status: "active", customer: "cus_1", metadata: { user_id: arun.id }, cancel_at_period_end: false, pause_collection: null, items: { data: [{ price: { id: "price_duo_y" }, current_period_end: periodEnd }] } });
const created = { id: "evt_st_1", type: "customer.subscription.created", data: { object: { id: "sub_st_1" } } };
check((await stripeHook(created, Math.floor(Date.now() / 1000) - 600)).status === 400, "Stripe webhook older than 5 minutes refused (400)");
res = await stripeHook(created);
check(res.status === 200 && (await res.json()).outcome === "processed", "signed Stripe webhook processed");
const arunRow = (await pool.query("select plan, interval, provider, status from subscriptions where user_id = $1", [arun.id])).rows[0];
check(arunRow?.plan === "duo" && arunRow.interval === "year" && arunRow.provider === "stripe" && arunRow.status === "active", "Arun on Duo yearly via Stripe");
const portal = await (async () => {
  const page = await (await get("/dashboard/plan", aj)).text();
  const form = [...page.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(">Card and invoices<"));
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) fd.append(m[1], m[2] ?? "");
  return fetch(`${B}/dashboard/plan`, { method: "POST", body: fd, redirect: "manual", headers: { cookie: aj.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
})();
check(portal.status === 303 && portal.headers.get("location") === "https://billing.stripe.com/p/session/fake", "Card and invoices opens Stripe's billing portal");

check(!/\[billing\].*failed/.test(log()), "no billing failures in the server log");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
