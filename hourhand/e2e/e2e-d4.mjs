// D4 embed on the host's site, prefill, and framing headers. Usage: node e2e/e2e-d4.mjs <port> <server-log> <database-url>
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
const { rows: [priya] } = await pool.query("select id, email from users where slug = 'priya'");
const framing = (res) => `${res.headers.get("x-frame-options") ?? ""}|${res.headers.get("content-security-policy") ?? ""}`;

for (const path of ["/dashboard/bookings", "/sign-in", "/api/health", "/"]) {
  const res = await get(path);
  check(/DENY/.test(framing(res)) && /frame-ancestors 'none'/.test(framing(res)), `${path} can't be framed by another site`);
}
for (const path of ["/priya", "/priya/coaching"]) {
  const res = await get(path);
  check(res.status === 200 && !/DENY|frame-ancestors/.test(framing(res)), `${path} can be embedded`);
}

const js = await get("/embed.js");
const src = await js.text();
check(js.status === 200 && /javascript/.test(js.headers.get("content-type") ?? ""), "embed.js served as JavaScript");
check(src.includes("data-hourhand-inline") && src.includes("data-hourhand-popup") && src.includes("e.origin !== origin"), "it handles inline and popup, and only trusts its own origin");
let syntaxOk = true;
try { new Function(src); } catch { syntaxOk = false; }
check(syntaxOk, "embed.js is valid JavaScript");

let html = await (await get("/priya/coaching?name=Asha%20Rao&email=asha%40example.in")).text();
check(html.includes("Asha Rao") && html.includes("asha@example.in"), "?name= and ?email= reach the booking form");
html = await (await get("/priya/coaching?name=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).text();
check(!html.includes("<script>alert(1)</script>"), "a prefilled name can't inject HTML");

const pj = await signIn(priya.email);
html = await (await get("/dashboard/profile", pj)).text();
check(html.includes("Put it on your website") && html.includes("data-hourhand-popup=&quot;") && html.includes("/embed.js"), "the host gets copy-and-paste embed code");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
