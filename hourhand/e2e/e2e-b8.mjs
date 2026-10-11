// B8 end to end: single-use links, one-off meetings, revoking, hidden event types. Usage: node e2e/e2e-b8.mjs <port> <server-log> <database-url>
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
async function waitFor(pred, ms = 12000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(300); } return pred(); }
const ip = "203.0.113.96";

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
  res.text = async () => (await text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
  return res;
};
async function signIn(email) {
  await fetch(`${B}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": ip }, body: JSON.stringify({ email, callbackURL: "/dashboard" }), signal: t() });
  await sleep(300);
  const j = jar();
  await get(lastLink(log(), email).replace(/^https?:\/\/[^/]+/, ""), j);
  return j;
}
/** Posts the no-JS form on `path` whose markup contains `marker`, with its hidden inputs plus `fields`. */
async function submit(j, path, marker, fields = {}) {
  const html = await (await get(path, j)).text();
  const form = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(marker));
  if (!form) return null;
  const fd = new FormData();
  const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of form.matchAll(/<input([^>]*)>/g)) {
    const name = /name="([^"]+)"/.exec(m[1])?.[1];
    if (name && !/type="(checkbox|radio)"/.test(m[1])) fd.append(name, unescape(/value="([^"]*)"/.exec(m[1])?.[1] ?? ""));
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(B + path, { method: "POST", body: fd, redirect: "manual", headers: { cookie: j.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
  j.take(res);
  return res;
}


await sleep(2500);
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows: [priya] } = await pool.query("select id, email, slug, timezone from users where slug = 'priya'");
const { rows: [arun] } = await pool.query("select id, email from users where slug = 'arun'");
const { rows: [coaching] } = await pool.query("select id from event_types where slug = 'coaching' and user_id = $1", [priya.id]);
const pq = await pool.query("select id from custom_questions where event_type_id = $1", [coaching.id]);
const answers = Object.fromEntries(pq.rows.map((r) => [r.id, "Plan"]));
const from = new Date().toISOString(), to = new Date(Date.now() + 30 * 864e5).toISOString();
const slotsBy = async (q) => { const r = await fetch(`${B}/api/slots?${new URLSearchParams({ ...q, from, to, tz: "Asia/Kolkata" })}`, { signal: t() }); return { status: r.status, body: await r.json() }; };
const bookBy = async (extra, start, key) => { const r = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${10 + Math.floor(Math.random() * 200)}` }, signal: t(),
  body: JSON.stringify({ ...extra, start, name: "Kiran Rao", email: `b8-${key}@example.com`, timezone: "Asia/Kolkata", answers, idempotencyKey: `e2e-b8-${key}-${Date.now()}` }) }); return { status: r.status, body: await r.json() }; };
const linkPath = (html) => /\/l\/([A-Za-z0-9_-]{43})/.exec(html)?.[1];

const pj = await signIn(priya.email);
let html = await (await get("/dashboard/links", pj)).text();
check(html.includes("New single-use link") && html.includes("Links"), "links page shows for the host");

// Single-use link: made from the form, shown once, never stored in the clear
let res = await submit(pj, "/dashboard/links", "Make a single-use link", { eventTypeId: coaching.id, label: "For Ravi" });
html = res ? await res.text() : "";
const token = linkPath(html);
check(res?.status === 200 && token, `form makes a link and shows it once (${res?.status})`);
const stored = await pool.query("select count(*)::int n from booking_links where token_hash = $1", [token]);
check(stored.rows[0].n === 0, "the raw token isn't in the database");

// Guest books through it
html = await (await get(`/l/${token}`)).text();
check(html.includes("this link works for one booking") && html.includes("Priya"), "link page shows the event and host");
const s1 = await slotsBy({ link: token });
check(s1.status === 200 && s1.body.slots.length > 2, `slots through the link (${s1.body.slots?.length})`);
const b1 = await bookBy({ linkToken: token }, s1.body.slots[0], "first");
check(b1.status === 201, `booking through the link -> ${b1.status}`);
const b2 = await bookBy({ linkToken: token }, s1.body.slots[1], "second");
check(b2.status === 409 && b2.body.error === "link_used", `second booking refused as used (${b2.status} ${b2.body.error})`);
html = await (await get(`/l/${token}`)).text();
check(html.includes("already been used") && !html.includes("Priya"), "used link page says so without naming the host");
html = await (await get("/dashboard/links", pj)).text();
check(html.includes("Used") && html.includes("Kiran Rao") && html.includes("For Ravi"), "links page shows it used, by whom, with the note");
const { rows: [linked] } = await pool.query("select booking_link_id from bookings where id = $1", [b1.body.bookingId]);
check(linked.booking_link_id !== null, "booking records the link it came through");

// Race: two guests on one fresh link at once
res = await submit(pj, "/dashboard/links", "Make a single-use link", { eventTypeId: coaching.id });
const raceToken = linkPath(await res.text());
const rs = (await slotsBy({ link: raceToken })).body.slots;
const race = await Promise.all([bookBy({ linkToken: raceToken }, rs[2], "race-a"), bookBy({ linkToken: raceToken }, rs[3], "race-b")]);
check(race.filter((r) => r.status === 201).length === 1 && race.some((r) => r.body.error === "link_used"), `two guests at once: exactly one books (${race.map((r) => r.status).join(", ")})`);

// Revoke
res = await submit(pj, "/dashboard/links", "Make a single-use link", { eventTypeId: coaching.id, label: "To revoke" });
const revokeToken = linkPath(await res.text());
const { rows: [rl] } = await pool.query("select id from booking_links where label = 'To revoke' and user_id = $1", [priya.id]);
res = await submit(pj, "/dashboard/links", `value="${rl.id}"`);
check(res?.status === 303 && (res.headers.get("location") ?? "").includes("done=revoked"), `revoke -> ${res?.status} ${res?.headers.get("location")}`);
check((await (await get(`/l/${revokeToken}`)).text()).includes("no longer works"), "revoked link page says it no longer works");
check((await slotsBy({ link: revokeToken })).status === 410, "revoked link's slots are gone (410)");

// One-off meeting: host picks times in their own zone
const day = new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-CA", { timeZone: priya.timezone });
const offered = [`${day}T07:15`, `${day}T21:45`];
res = await submit(pj, "/dashboard/links/new", "Make the one-off link", { name: "Contract review", durationMinutes: "30", locationKind: "google_meet", times: offered[0] });
// submit() sets one value per name; post the second time by building the form directly
const fd = new FormData();
const page = await (await get("/dashboard/links/new", pj)).text();
const form = [...page.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes("Make the one-off link"));
for (const m of form.matchAll(/<input([^>]*)>/g)) {
  const name = /name="([^"]+)"/.exec(m[1])?.[1];
  if (name && name.startsWith("$ACTION")) fd.append(name, (/value="([^"]*)"/.exec(m[1])?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}
for (const [k, v] of Object.entries({ name: "Contract review", durationMinutes: "30", locationKind: "google_meet", description: "" })) fd.set(k, v);
for (const v of offered) fd.append("times", v);
const r2 = await fetch(`${B}/dashboard/links/new`, { method: "POST", body: fd, redirect: "manual", headers: { cookie: pj.header(), origin: B, "x-forwarded-for": ip }, signal: t() });
const ooToken = linkPath(await r2.text());
check(ooToken, `one-off form makes a link (${r2.status})`);
const oo = await slotsBy({ link: ooToken });
const want = offered.map((v) => new Date(new Date(`${v}:00Z`).getTime() - (priya.timezone === "Asia/Kolkata" ? 330 : 0) * 60_000).toISOString());
check(oo.status === 200 && JSON.stringify(oo.body.slots) === JSON.stringify(want), `one-off offers exactly the two times, read in the host's zone (${oo.body.slots?.join(", ")})`);
const { rows: [ooType] } = await pool.query("select e.slug, e.kind, e.hidden from booking_links l join event_types e on e.id = l.event_type_id where l.user_id = $1 order by l.created_at desc limit 1", [priya.id]);
check(ooType.kind === "one_off" && ooType.hidden, "stored as a hidden one-off type");
check((await get(`/${priya.slug}/${ooType.slug}`)).status === 404, "one-off isn't reachable by its slug");
check(!(await (await get("/dashboard/event-types", pj)).text()).includes("Contract review"), "one-off stays off the Event types list");
const ob = await bookBy({ linkToken: ooToken }, oo.body.slots[1], "oneoff");
check(ob.status === 201, `guest books one of the offered times -> ${ob.status}`);
check(await waitFor(() => new RegExp(`\\[dev\\] email to b8-oneoff[^:]*: Booked:`).test(log())), "guest gets the confirmation email");

// Hidden event type: off the profile, its own link still books
await pool.query("update event_types set hidden = true where id = $1", [coaching.id]);
html = await (await get(`/${priya.slug}`)).text();
check(!html.includes(`/${priya.slug}/coaching`), "hidden event type is off the public profile");
check((await get(`/${priya.slug}/coaching`)).status === 200, "its own page still works");
await pool.query("update event_types set hidden = false where id = $1", [coaching.id]);

// Another host can't touch Priya's links
const aj = await signIn(arun.email);
const { rows: [openLink] } = await pool.query("select id from booking_links where user_id = $1 and label is null order by created_at desc limit 1", [priya.id]);
html = await (await get("/dashboard/links", aj)).text();
const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
check(visible.includes("No links yet") && !visible.includes("Kiran Rao") && !visible.includes("For Ravi"), `another host sees none of Priya's links (${visible.includes("No links yet") ? "empty list" : visible.slice(visible.indexOf("Your links"), visible.indexOf("Your links") + 120).replace(/\s+/g, " ")})`);

check(!/Unhandled|TypeError/.test(log()), "no errors in the server log");
await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
