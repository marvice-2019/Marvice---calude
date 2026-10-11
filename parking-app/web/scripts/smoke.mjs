// No-browser smoke test of the built web app against a running API (fake gateway, console OTP, seeded dev DB).
// Drives the real routes the pages use: SSR pages, SEO output, the BFF proxy, sign-in, book → pay → pass,
// promo, Park now, Mark my spot, extend, cancel, valet desks. Exits non-zero on the first failure.
// Usage: WEB_URL=http://localhost:3001 API_LOG=/path/to/api.log node scripts/smoke.mjs
import { readFileSync } from "node:fs";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const API_LOG = process.env.API_LOG;
const PHONE = process.env.SMOKE_PHONE ?? "98450" + String(Date.now()).slice(-5);
let jar = {}, pass = 0;

function cookieHeader() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "); }
function keep(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";"); const i = kv.indexOf("=");
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (v) jar[k] = v; else delete jar[k];
  }
}
async function req(path, { method = "GET", body, idem } = {}) {
  const headers = { cookie: cookieHeader() };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idem) headers["idempotency-key"] = "smoke-" + Math.random().toString(36).slice(2);
  const res = await fetch(WEB + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  keep(res);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, json };
}
function check(name, ok, detail = "") {
  if (!ok) { console.error(`FAIL ${name}${detail ? " — " + String(detail).slice(0, 400) : ""}`); process.exit(1); }
  pass++; console.log(`ok   ${name}`);
}
const hasKeys = (o, keys) => o && keys.every(k => k in o);
const iso = ms => new Date(Date.now() + ms).toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function confirmed(id) {
  for (let i = 0; i < 20; i++) {
    const r = await req("/api/bff/v1/bookings");
    const b = r.json?.find?.(x => x.id === id);
    if (b && ["confirmed", "checked_in"].includes(b.status)) return b;
    await sleep(300);
  }
  return null;
}

// --- pages and SEO ---
const home = await req("/");
check("home renders hero and search", home.status === 200 && home.text.includes("Your bay is") && home.text.includes("Where are you going?"));
for (const p of ["/park-now", "/valet", "/passes", "/monthly", "/account", "/list-your-space"]) {
  const r = await req(p); check(`page ${p}`, r.status === 200, r.status);
}
const robots = await req("/robots.txt");
check("robots.txt points to sitemap and hides private pages", robots.text.includes("sitemap.xml") && robots.text.includes("Disallow: /passes"));
const sitemap = await req("/sitemap.xml");
check("sitemap lists area landing pages", sitemap.text.includes("/parking/mg-road") && sitemap.text.includes("/parking/koramangala"), sitemap.text.slice(0, 300));
const area = await req("/parking/mg-road");
check("SEO page /parking/mg-road is server-rendered with lots", area.status === 200 && area.text.includes("Parking near MG Road") && area.text.includes("MG Road Metro Multilevel"));
check("SEO page carries ItemList + ParkingFacility JSON-LD", area.text.includes('"@type":"ItemList"') && area.text.includes('"@type":"ParkingFacility"'));
check("SEO page has canonical URL", /<link rel="canonical" href="[^"]*\/parking\/mg-road"/.test(area.text));
check("unknown area 404s", (await req("/parking/atlantis")).status === 404);

// --- search through the BFF (and type drift against lib/types.ts) ---
const range = `from=${encodeURIComponent(iso(3 * 3600e3))}&to=${encodeURIComponent(iso(6 * 3600e3))}&vehicle=car`;
const search = await req(`/api/bff/v1/lots/search?lat=12.9756&lng=77.6066&${range}`);
check("search returns lots near MG Road", search.status === 200 && Array.isArray(search.json) && search.json.length >= 3, search.text);
const row = search.json[0];
check("SearchRow shape matches lib/types.ts", hasKeys(row, ["lot", "distance_m", "quote", "spots_left"]) &&
  hasKeys(row.lot, ["id", "name", "code", "address", "kind", "covered", "ev_chargers", "open_24h", "status", "valet"]) &&
  hasKeys(row.quote, ["hours", "ratePaise", "basePaise", "discountPaise", "feePaise", "gstPaise", "totalPaise", "promoCode"]), JSON.stringify(row));
const q = row.quote;
check("quote math: total = base − discount + fee + GST", q.totalPaise === q.basePaise - q.discountPaise + q.feePaise + q.gstPaise);
check("quote GST is 18% of (base − discount + fee)", q.gstPaise === Math.round((q.basePaise - q.discountPaise + q.feePaise) * 0.18));
const ev = await req(`/api/bff/v1/lots/search?lat=12.9756&lng=77.6066&${range}&filters=ev`);
check("EV filter keeps only lots with chargers", ev.json.length > 0 && ev.json.every(r => r.lot.ev_chargers > 0));
const dests = await req("/api/bff/v1/destinations?q=mall");
check("destination search finds malls", Array.isArray(dests.json) && dests.json.some(d => d.kind === "mall"));
check("BFF refuses paths outside the allow-list", (await req("/api/bff/v1/admin/promos", { method: "POST", body: {} })).status === 404);

const mg = search.json.find(r => r.lot.code === "BLR101");
const lotPage = await req(`/lots/${mg.lot.id}?${range}`);
check("lot page SSR with ParkingFacility + Offer JSON-LD", lotPage.status === 200 && lotPage.text.includes('"@type":"ParkingFacility"') && lotPage.text.includes('"@type":"Offer"'));
check("lot page shows the price breakdown with GST", lotPage.text.includes("GST 18%") && lotPage.text.includes("Platform fee"));
check("lot page does not load the payment script up front", !lotPage.text.includes("checkout.razorpay.com"));

// --- sign in ---
check("signed-out /me is 401 through the BFF", (await req("/api/bff/v1/me")).status === 401);
const otp = await req("/api/auth/otp", { method: "POST", body: { phone: PHONE } });
check("OTP sent", otp.status === 200, otp.text);
let code = null;
if (API_LOG) { const m = [...readFileSync(API_LOG, "utf8").matchAll(new RegExp(`\\+91${PHONE}: (\\d{6})`, "g"))].pop(); code = m?.[1]; }
check("OTP readable from the API's console log", !!code, "set API_LOG to the API's stdout file");
const ver = await req("/api/auth/verify", { method: "POST", body: { phone: PHONE, otp: code } });
check("verify sets httpOnly session cookies and hides tokens", ver.status === 200 && jar.bl_access && !("access" in (ver.json ?? {})), ver.text);

// --- promo + pre-book + pay + pass ---
const promo = await req("/api/bff/v1/quotes", { method: "POST", body: { lot_id: mg.lot.id, from: iso(3 * 3600e3), to: iso(6 * 3600e3), vehicle: "car", promo: "FIRST50" } });
check("FIRST50 promo discounts before GST", promo.json?.discountPaise > 0 && promo.json.gstPaise === Math.round((promo.json.basePaise - promo.json.discountPaise + promo.json.feePaise) * 0.18), promo.text);
const bad = await req("/api/bff/v1/quotes", { method: "POST", body: { lot_id: mg.lot.id, from: iso(3 * 3600e3), to: iso(6 * 3600e3), vehicle: "car", promo: "NOPE" } });
check("bad promo returns a plain reason, not an error", bad.status === 200 && typeof bad.json?.promo_error === "string" && bad.json.discountPaise === 0, bad.text);

const book = await req("/api/bff/v1/bookings", { method: "POST", idem: true, body: { lot_id: mg.lot.id, from: iso(3 * 3600e3), to: iso(6 * 3600e3), vehicle_kind: "car", plate: "KA01AB1234", promo: "FIRST50" } });
check("pre-booking created with a test gateway order", book.status === 201 && book.json.razorpay_order.key_id === "rzp_test_fake", book.text);
check("booking total equals the promo quote", book.json.booking.total_paise === promo.json.totalPaise, `${book.json.booking.total_paise} vs ${promo.json.totalPaise}`);
const paid = await req("/api/dev/pay", { method: "POST", body: { order_id: book.json.razorpay_order.id, amount: book.json.razorpay_order.amount } });
check("dev pay signs a webhook the API accepts", paid.status === 200, paid.text);
const pass1 = await confirmed(book.json.booking.id);
check("pass issued after the webhook", !!pass1 && pass1.code === book.json.booking.code);
const replay = await req("/api/dev/pay", { method: "POST", body: { order_id: book.json.razorpay_order.id, amount: book.json.razorpay_order.amount } });
check("second capture for the same order is harmless", replay.status === 200 && (await req("/api/bff/v1/bookings")).json.filter(b => b.id === pass1.id).length === 1, replay.text);

// --- Park now + spot + extend ---
const lookup = await req("/api/bff/v1/lots/by-code/102");
check("Park now finds lot 102 from digits only", lookup.json?.lot?.code === "BLR102", lookup.text);
const pn = await req("/api/bff/v1/bookings", { method: "POST", idem: true, body: { lot_id: lookup.json.lot.id, source: "park_now", hours: 1, plate: "KA01AB1234" } });
check("Park now booking created", pn.status === 201 && pn.json.booking.source === "park_now", pn.text);
await req("/api/dev/pay", { method: "POST", body: { order_id: pn.json.razorpay_order.id, amount: pn.json.razorpay_order.amount } });
const pn2 = await confirmed(pn.json.booking.id);
check("Park now pass live", !!pn2);
const spot = await req(`/api/bff/v1/bookings/${pn2.id}/spot`, { method: "POST", body: { floor: "B2", bay: "47", note: "Lift C" } });
check("Mark my spot saved", spot.status === 200 && spot.json.spot.bay === "47", spot.text);
const ext = await req(`/api/bff/v1/bookings/${pn2.id}/extend`, { method: "POST", idem: true });
check("extend by an hour creates an order", ext.status === 201 && ext.json.razorpay_order, ext.text);
await req("/api/dev/pay", { method: "POST", body: { order_id: ext.json.razorpay_order.id, amount: ext.json.razorpay_order.amount } });
let extended = false;
for (let i = 0; i < 20 && !extended; i++) { const b = (await req("/api/bff/v1/bookings")).json.find(x => x.id === pn2.id); extended = Date.parse(b.to) > Date.parse(pn2.to); if (!extended) await sleep(300); }
check("extension moves the end time after payment", extended);

// --- cancel, account, valet ---
const cancel = await req(`/api/bff/v1/bookings/${pass1.id}/cancel`, { method: "POST", idem: true });
check("cancel more than 1 h before arrival refunds in full", cancel.status === 200 && /refund/i.test(cancel.json?.refund?.message ?? ""), cancel.text);
const me = await req("/api/bff/v1/me");
check("Me shape matches lib/types.ts and has the plate", hasKeys(me.json, ["user", "vehicles", "favourites", "preferences"]) && me.json.vehicles.some(v => v.plate === "KA01AB1234"), me.text);
const desks = await req("/api/bff/v1/valet/desks?lat=12.9716&lng=77.5946");
check("valet desks near UB City with GST and validator", desks.json?.some(d => d.gst_paise === Math.round(d.fee_paise * 0.18) && d.validator), desks.text);
const tickets = await req("/api/bff/v1/valet/tickets");
check("valet tickets list for the driver", tickets.status === 200 && Array.isArray(tickets.json), tickets.text);
const out = await req("/api/auth/logout", { method: "POST", body: {} });
check("logout clears the session", out.status === 200 && !jar.bl_access && (await req("/api/bff/v1/me")).status === 401);

console.log(`\n${pass} checks passed`);
