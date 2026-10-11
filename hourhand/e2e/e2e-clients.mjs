// C-12 clients end to end against the local server and the fake host-side Razorpay.
// Usage: node e2e/e2e-clients.mjs <port> <server-log> <database-url> <rzp-port>
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
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const { rows: [g] } = await pool.query("select i.name, i.email, b.id from invitees i join bookings b on b.id = i.booking_id where b.host_id = $1 and b.status = 'confirmed' order by b.start_at limit 1", [priya.id]);
const pj = await signIn(priya.email);
let html = await (await get("/dashboard/clients", pj)).text();
check(html.includes(g.name), `clients page lists ${g.name}`);
const key = /href="\/dashboard\/clients\/([0-9a-f]{20})"/.exec(html)?.[1];
check(Boolean(key), "client has a page");
const page = `/dashboard/clients/${key}`;
html = await (await get(page, pj)).text();
check(html.includes("Private note") && html.includes("History"), "client page shows note and history");
const res = await submitForm(pj, page, 'name="note"', { key, note: "Working on interview prep. Prefers mornings." });
check(res?.status === 303 && res.headers.get("location")?.includes("saved=1"), `note saved (${res?.status})`);
const who = (await pool.query("select i.email from invitees i join bookings b on b.id = i.booking_id where b.host_id = $1", [priya.id])).rows.find((r) => r.email.toLowerCase() === g.email.toLowerCase());
const stored = (await pool.query("select note from client_notes where host_id = $1 and email = $2", [priya.id, who.email])).rows[0]?.note;
check(stored === "Working on interview prep. Prefers mornings.", "note stored for this host and client");
html = await (await get(`/dashboard/bookings/${g.id}`, pj)).text();
check(html.includes("Your note:") && html.includes("Working on interview prep"), "booking page shows the note");
check(html.includes("Client history and notes"), "booking page links to the client");
// Another host can't reach this client or write a note about them.
const { rows: [arun] } = await pool.query("select email from users where slug = 'arun'");
const aj = await signIn(arun.email);
check((await get(page, aj)).status === 404, "another host gets 404 for the client page");
// Replay the note form's action (taken from the right host's page) with the other host's session and the same client key.
const formHtml = await (await get(page, pj)).text();
const form = [...formHtml.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes('name="note"'));
const fd = new FormData();
for (const m of form.matchAll(/<input[^>]*name="([^"]+)"(?:\s+value="([^"]*)")?[^>]*>/g)) if (m[1].startsWith("$ACTION")) fd.append(m[1], (m[2] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
fd.append("key", key); fd.append("note", "Written by someone else");
const forged = await fetch(B + page, { method: "POST", body: fd, redirect: "manual", headers: { cookie: aj.header(), origin: B, "x-forwarded-for": ip } });
check(forged.status === 303 && forged.headers.get("location")?.includes("error=not_found"), `another host's note on this client is refused (${forged.headers.get("location")})`);
check((await pool.query("select count(*)::int as n from client_notes")).rows[0].n === 1, "no stray notes");
// Earnings (C-16): the page and its CSV for the signed-in host only.
html = await (await get("/dashboard/earnings", pj)).text();
check(html.includes("Net received") && html.includes("Sessions"), "earnings page shows this month");
const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const csvRes = await get(`/dashboard/earnings/export?month=${month}`, pj);
check(csvRes.status === 200 && (await csvRes.text()).startsWith("Item,Value"), "earnings CSV downloads");
check((await get(`/dashboard/earnings/export?month=${month}`)).status === 401, "earnings CSV needs sign-in");
check((await get(`/dashboard/earnings/export?month=bad`, pj)).status === 400, "a bad month is refused");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
