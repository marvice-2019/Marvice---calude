// D7 automatic WhatsApp against a fake Cloud API. Usage: node e2e/e2e-d7.mjs <port> <server-log> <database-url> <fake-meta-port>
import { createHmac } from "node:crypto";
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
const M = `http://127.0.0.1:${process.argv[5]}`;
const sign = (body) => `sha256=${createHmac("sha256", "e2e-wa-app-key").update(body).digest("hex")}`;
const sentToMeta = async () => (await (await fetch(`${M}/__state`, { signal: t() })).json()).messages;
await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching' and e.user_id = $1", [priya.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));

let html = await (await get("/priya/coaching")).text();
// The details form renders after a time is picked; the page hands it the "whatsapp" flag.
const offers = (page) => /\\?"whatsapp\\?":true/.test(page);
check(/\\?"whatsapp\\?":false/.test(html), "on the free plan the booking form doesn't offer WhatsApp");
await pool.query("insert into subscriptions (user_id, plan, status) values ($1, 'solo', 'active') on conflict (user_id) do update set plan = 'solo', status = 'active'", [priya.id]);
html = await (await get("/priya/coaching")).text();
check(offers(html), "on Solo it offers the WhatsApp tick");

const from = new Date(Date.now() + 2 * 864e5).toISOString(), to = new Date(Date.now() + 21 * 864e5).toISOString();
const slots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const bookAt = (start, extra) => fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.71" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start, name: "Kiran Rao", email: `d7-${Date.now()}@example.com`, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-d7-${Math.random()}`, ...extra }) });
let res = await bookAt(slots[0], { whatsappOptIn: true });
check(res.status === 400 && (await res.json()).fields?.phone, "ticking WhatsApp without a number asks for one");
res = await bookAt(slots[0], { whatsappOptIn: true, phone: "+91 98765 43210" });
const b = await res.json();
check(res.status === 201 && Boolean(b.bookingId), `a guest books with WhatsApp ticked (${res.status})`);
const ok = await waitFor(async () => (await sentToMeta()).some((m) => m.template?.name === "hh_booking_confirmed"), 30000);
const msg = (await sentToMeta()).find((m) => m.template?.name === "hh_booking_confirmed");
check(ok && msg.to === "919876543210", "the job runner sends the confirmation template to the guest's number");
check(msg?.template.components[1].parameters[0].text === b.manageToken, "its button opens the guest's own manage link");
check(msg?.template.components[0].parameters[2].text === "Priya Raman", "with the host's name in it");
const rows = (await pool.query("select kind, status, provider_message_id from notifications where booking_id = $1 and channel = 'whatsapp' order by kind", [b.bookingId])).rows;
check(rows.length === 2 && rows[0].status === "sent" && rows[0].provider_message_id === "wamid.e2e.1" && rows[1].kind === "reminder_guest" && rows[1].status === "queued",
  "the confirmation is recorded as sent and the day-ahead reminder waits");
res = await bookAt(slots[1], { phone: "+91 98765 43211" });
const quiet = await res.json();
await sleep(1500);
check((await pool.query("select count(*)::int as n from notifications where booking_id = $1 and channel = 'whatsapp'", [quiet.bookingId])).rows[0].n === 0, "no tick, no WhatsApp");

let vr = await fetch(`${B}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=314`, { signal: t() });
check(vr.status === 200 && (await vr.text()) === "314", "Meta's webhook handshake is answered");
vr = await fetch(`${B}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=314`, { signal: t() });
check(vr.status === 403, "a wrong verify token is refused");
const stop = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "919876543210", type: "text", text: { body: "STOP" } }] } }] }] });
let wh = await fetch(`${B}/api/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign("forged") }, body: stop, signal: t() });
check(wh.status === 401, "an unsigned webhook is refused");
wh = await fetch(`${B}/api/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(stop) }, body: stop, signal: t() });
check(wh.status === 200, "a signed STOP is accepted");
check((await pool.query("select 1 from whatsapp_opt_outs where phone = '919876543210'")).rowCount === 1, "the number is opted out");
check((await pool.query("select status from notifications where booking_id = $1 and kind = 'reminder_guest' and channel = 'whatsapp'", [b.bookingId])).rows[0].status === "skipped", "and its reminder won't go");
check((await sentToMeta()).some((m) => m.type === "text" && m.to === "919876543210"), "the guest gets one reply saying so");

const pj = await signIn(priya.email);
html = await (await get(`/dashboard/bookings/${b.bookingId}`, pj)).text();
check(html.includes("Confirmation: sent automatically") && html.includes("guest replied STOP on WhatsApp"), "the host sees what WhatsApp sent and why the reminder won't go");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
