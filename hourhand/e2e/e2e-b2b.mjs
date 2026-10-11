// B2b end to end against the local server only. Usage: node e2e/e2e-b2b.mjs <port> <server-log> <database-url>
import { readFileSync } from "node:fs";
import pg from "pg";

/** The last sign-in link the log mailer printed for `email` (the email's "Sign in:" line). */
const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];

const [port, logPath, databaseUrl] = process.argv.slice(2);
const B = `http://localhost:${port}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    take(res) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (/max-age=0/i.test(raw) || value === "") cookies.delete(name); else cookies.set(name, value);
      }
    },
  };
}
async function get(path, j, ip = "203.0.113.99") {
  const res = await fetch(B + path, { redirect: "manual", headers: { "x-forwarded-for": ip, ...(j ? { cookie: j.header() } : {}) }, signal: t() });
  j?.take(res);
  return res;
}
const askLink = (email, ip) => fetch(`${B}/api/auth/sign-in/magic-link`, {
  method: "POST", headers: { "content-type": "application/json", origin: B, "x-forwarded-for": ip }, body: JSON.stringify({ email, callbackURL: "/dashboard/event-types" }), signal: t(),
});
async function signIn(email, ip) {
  const res = await askLink(email, ip);
  await new Promise((r) => setTimeout(r, 300));
  const url = lastLink(readFileSync(logPath, "utf8"), email);
  const j = jar();
  const verify = url ? await get(url.replace(/^https?:\/\/[^/]+/, ""), j) : null;
  return { status: res.status, j, verify };
}

await new Promise((r) => setTimeout(r, 2500));

// Rate limit on the sign-in endpoint: 5 links per 10 minutes per address
const statuses = [];
for (let i = 0; i < 7; i++) statuses.push((await askLink(`flood${i}@example.com`, "203.0.113.50")).status);
check(statuses.slice(0, 5).every((s) => s === 200) && statuses.slice(5).every((s) => s === 429), `7 link requests from one address -> ${statuses.join(",")}`);
check((await askLink("other@example.com", "203.0.113.51")).status === 200, "a different address is not affected");
const forged = [];
for (let i = 0; i < 7; i++) forged.push((await askLink(`forge${i}@example.com`, `198.18.0.${i}, 203.0.113.52`)).status);
check(forged.slice(5).every((s) => s === 429), `rotating forged addresses before the proxy's entry are still limited -> ${forged.join(",")}`);

// Per-email limit on direct calls to Better Auth, even from rotating addresses
const perEmail = [];
for (let i = 0; i < 4; i++) perEmail.push((await askLink("inbox@example.com", `203.0.113.${80 + i}`)).status);
check(perEmail.slice(0, 3).every((s) => s === 200) && perEmail[3] !== 200, `4 links for one inbox from 4 addresses -> ${perEmail.join(",")}`);

// Replaying another host's request key gets a conflict, never their booking
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slotsOf = async (slug, event) => (await (await fetch(`${B}/api/slots?slug=${slug}&event=${event}&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const pq = await new pg.Pool({ connectionString: databaseUrl }).query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching'");
const book = (slug, event, start, key, answers = {}) => fetch(`${B}/api/bookings`, {
  method: "POST", headers: { "content-type": "application/json" }, signal: t(),
  body: JSON.stringify({ slug, event, start, name: "Kiran Rao", email: "kiran@example.com", timezone: "Asia/Kolkata", answers, idempotencyKey: key }),
});
const priyaBook = await book("priya", "coaching", (await slotsOf("priya", "coaching"))[0], "e2e-shared-key-1", { [pq.rows[0].id]: "Plan" });
const replay = await book("arun", "chat", (await slotsOf("arun", "chat"))[0], "e2e-shared-key-1");
const replayBody = await replay.json();
check(priyaBook.status === 201 && replay.status === 409 && replayBody.error === "key_conflict" && !replayBody.manageToken, `Arun's page replaying Priya's key -> ${replay.status} ${replayBody.error}`);

// Close an account through the real data-layer code
const host = await signIn("closing@example.com", "203.0.113.60");
check(host.verify?.status === 302, `new host signs in -> ${host.verify?.status}`);
check((await get("/dashboard/settings", host.j)).status === 200, "settings open while the account is active");
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows } = await pool.query("select id, slug from users where email = 'closing@example.com'");
const slug = rows[0].slug;
check((await get(`/${slug}`)).status === 200, `public page /${slug} is live before closing`);
const { closeAccount } = await import("../src/lib/data/account-lifecycle.ts");
const c = await pool.connect();
await c.query("begin"); await closeAccount(c, rows[0].id, new Date()); await c.query("commit"); c.release();

const after = await get("/dashboard/settings", host.j);
check(after.status === 307 && (after.headers.get("location") ?? "").includes("/sign-in"), `old session after closing -> ${after.status} ${after.headers.get("location")}`);
check((await get(`/${slug}`)).status === 404, `public page after closing -> 404`);
const again = await signIn("closing@example.com", "203.0.113.61");
check(again.verify && (again.verify.headers.get("location") ?? "").includes("error"), `magic link for the closed account -> ${again.verify?.status} ${again.verify?.headers.get("location")}`);
const sessions = await pool.query("select count(*)::int as n from auth_sessions where user_id = $1", [rows[0].id]);
check(sessions.rows[0].n === 0, `closed account has ${sessions.rows[0].n} sessions`);
await pool.end();

process.exit(fail ? 1 : 0);
