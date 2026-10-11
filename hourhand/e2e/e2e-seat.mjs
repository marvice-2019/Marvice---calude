// C-4 Duo seat end to end: invite, accept, manage the owner's account, owner-only pages, revocation. Usage: node e2e/e2e-seat.mjs <port> <server-log> <database-url>
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
const { rows: [priya] } = await pool.query("select id, email, name from users where slug = 'priya'");
const { rows: [arun] } = await pool.query("select id, email, name from users where slug = 'arun'");
const { rows: [pg1] } = await pool.query("select b.id, i.name from bookings b join invitees i on i.booking_id = b.id where b.host_id = $1 and b.status = 'confirmed' order by b.start_at limit 1", [priya.id]);
const arunGuests = (await pool.query("select i.name from invitees i where i.host_id = $1", [arun.id])).rows.map((r) => r.name);
check(!arunGuests.includes(pg1.name), `fixture: ${pg1.name} is Priya's guest only`);

const pj = await signIn(priya.email);
let html = await (await get("/dashboard/plan", pj)).text();
check(!html.includes("Your second person"), "no second person on a non-Duo plan");
await pool.query("insert into subscriptions (user_id, plan, status) values ($1, 'duo', 'active') on conflict (user_id) do update set plan = 'duo', status = 'active'", [priya.id]);
html = await (await get("/dashboard/plan", pj)).text();
check(html.includes("Your second person"), "Duo owner sees the second-person card");
let res = await submitForm(pj, "/dashboard/plan", 'name="email"', { email: arun.email });
check(res?.status === 200 && (await res.text()).includes("Invitation sent"), `owner invites ${arun.email}`);
check(await waitFor(() => log().includes(`[dev] email to ${arun.email}: ${priya.name} added you to their Hourhand plan`)), "invitation emailed");

const aj = await signIn(arun.email);
html = await (await get("/dashboard/event-types", aj)).text();
check(html.includes("invited you to be the second person"), "invitee sees the invitation");
res = await submitForm(aj, "/dashboard/event-types", ">Accept<", {});
check(res?.status === 200 || res?.status === 303, `invitee accepts (${res?.status})`);
check((await pool.query("select accepted_at is not null as a from seats where owner_id = $1", [priya.id])).rows[0]?.a, "seat accepted");
html = await (await get("/dashboard/event-types", aj)).text();
check(html.includes(`Manage ${priya.name}`), "member gets a switch to the owner's account");

// Before switching, the member's bookings are their own.
check(!(await (await get("/dashboard/bookings", aj)).text()).includes(pg1.name), "member's own bookings don't show the owner's guests");
res = await submitForm(aj, "/dashboard/event-types", `Manage ${priya.name}`, {});
check(res?.status === 303 && /\/dashboard\/bookings/.test(res.headers.get("location") ?? ""), `switching lands on the owner's bookings (${res?.status})`);
html = await (await get("/dashboard/bookings", aj)).text();
check(html.includes(pg1.name) && (html.includes("You&#x27;re managing") || html.includes("You're managing")), "member now sees the owner's bookings, with a banner");
check((await get(`/dashboard/bookings/${pg1.id}`, aj)).status === 200, "member opens an owner's booking");
check(!/href="\/dashboard\/plan"/.test(html) && !/href="\/dashboard\/settings"/.test(html) && !/href="\/dashboard\/earnings"/.test(html), "owner-only pages leave the nav while managing");
html = await (await get("/dashboard/plan", aj)).text();
check(!html.includes("Your second person") && !html.includes(arun.email + "</span>) is your second person"), "plan page stays the member's own (no owner billing or seat)");
html = await (await get("/dashboard/settings", aj)).text();
check(!html.includes(priya.email), "settings stay the member's own");
const csv = await get("/dashboard/invoices/export?month=2026-10", aj);
check(!(await csv.text()).includes(pg1.name), "invoice export stays the member's own");

// The owner removes the seat: the member's cookie no longer works, on the very next request.
res = await submitForm(pj, "/dashboard/plan", ">Remove<", {});
check(res?.status === 200 || res?.status === 303, `owner removes the seat (${res?.status})`);
html = await (await get("/dashboard/bookings", aj)).text();
check(!html.includes(pg1.name) && !html.includes("You&#x27;re managing"), "after removal the member is back on their own account");
const after = await get(`/dashboard/bookings/${pg1.id}`, aj);
check(after.status !== 200 || !(await after.text()).includes(pg1.name), "and can no longer open the owner's booking");

// A cookie naming an owner without a seat does nothing.
const forged = { header: () => `${aj.header()}; hh_acting=${priya.id}`, take: () => {} };
check(!(await (await get("/dashboard/bookings", forged)).text()).includes(pg1.name), "a hand-made acting cookie gives no access");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
