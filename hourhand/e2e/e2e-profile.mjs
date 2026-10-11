// C-13 the host's page as a mini website. Usage: node e2e/e2e-profile.mjs <port> <server-log> <database-url>
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
const pj = await signIn(priya.email);

let html = await (await get("/dashboard/profile", pj)).text();
check(html.includes("Your page") && html.includes("Google reviews link"), "dashboard has the page editor");
let res = await submitForm(pj, "/dashboard/profile", 'name="reviewsUrl"', { headline: "Career coach", bio: "Ten years helping new managers.", area: "Indiranagar, Bengaluru",
  whatsapp: "98765 43210", instagram: "@priya.coach", reviewsUrl: "https://evil.example/google.com" });
check(res?.status === 200 && (await res.text()).includes("Paste the https link to your Google reviews"), "a non-Google reviews link is refused");
res = await submitForm(pj, "/dashboard/profile", 'name="reviewsUrl"', { headline: "Career coach", bio: "Ten years helping new managers.", area: "Indiranagar, Bengaluru",
  whatsapp: "98765 43210", instagram: "@priya.coach", reviewsUrl: "https://g.page/r/priya-test" });
check(res?.status === 200, `profile saves (${res?.status})`);
const saved = (await pool.query("select headline, whatsapp, instagram, reviews_url from profiles where user_id = $1", [priya.id])).rows[0];
check(saved?.whatsapp === "+919876543210" && saved?.instagram === "priya.coach" && saved?.reviews_url === "https://g.page/r/priya-test", "details stored, cleaned up");

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
res = await submitForm(pj, "/dashboard/profile", 'name="photo"', { photo: new Blob([png], { type: "image/png" }) });
check(res?.status === 200, `photo uploads (${res?.status})`);
res = await submitForm(pj, "/dashboard/profile", 'name="photo"', { photo: new Blob(["<svg onload=alert(1)>"], { type: "image/png" }) });
check(res?.status === 200 && (await res.text()).includes("Use a JPEG, PNG or WebP photo"), "an SVG dressed as PNG is refused");
check((await pool.query("select mime from profile_photos where user_id = $1", [priya.id])).rows[0]?.mime === "image/png", "the good photo stays");

const pub = await get("/priya");
html = await pub.text();
check(pub.status === 200 && html.includes("Career coach") && html.includes("Ten years helping new managers.") && html.includes("Indiranagar, Bengaluru"), "public page shows headline, about and area");
check(html.includes("https://wa.me/919876543210?text="), "WhatsApp button uses the public number");
check(html.includes('href="https://g.page/r/priya-test"') && html.includes("Read reviews on Google"), "reviews button points at Google");
check(/<img[^>]+src="\/api\/photo\/priya\?v=\d+"/.test(html), "photo shown");
const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
let d = null; try { d = JSON.parse(ld); } catch { /* checked below */ }
check(d?.["@type"] === "ProfessionalService" && d.makesOffer?.length > 0, "page carries schema.org markup with the services");
check(/<title>[^<]*Priya[^<]*Career coach/.test(html), "title names the host and headline");
const photo = await get("/api/photo/priya");
check(photo.status === 200 && photo.headers.get("content-type") === "image/png" && photo.headers.get("x-content-type-options") === "nosniff", "photo served as PNG, no sniffing");
check((await get("/api/photo/nobody-here")).status === 404, "no photo for an unknown page");

await pool.end();
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
