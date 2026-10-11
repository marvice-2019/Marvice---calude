// Fakes of the Razorpay and Stripe endpoints Hourhand calls, on two ports. Usage: node e2e/fake-billing.mjs <rzp-port> <stripe-port>
import { createServer } from "node:http";

const [rzpPort, stripePort] = process.argv.slice(2).map(Number);
const state = { calls: [], rzp: {}, stripe: {} };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

function control(p, req, body, res) {
  if (p === "/__state") return json(res, 200, state), true;
  if (p === "/__set" && req.method === "POST") { const { provider, sub } = JSON.parse(body); state[provider][sub.id] = sub; return json(res, 200, {}), true; }
  return false;
}

createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const body = await read(req);
  if (control(p, req, body, res)) return;
  state.calls.push({ provider: "razorpay", method: req.method, path: p, auth: req.headers.authorization, body });
  if (!req.headers.authorization?.startsWith("Basic ")) return json(res, 401, { error: { code: "BAD_REQUEST_ERROR", description: "auth" } });
  if (p === "/v1/subscriptions" && req.method === "POST") return json(res, 200, { id: "sub_rzp_1", status: "created", short_url: "https://rzp.io/i/fake1" });
  const m = /^\/v1\/subscriptions\/([^/]+)(?:\/(cancel|pause|resume))?$/.exec(p);
  const sub = m && state.rzp[m[1]];
  if (!sub) return json(res, 404, { error: { code: "BAD_REQUEST_ERROR", description: "not found" } });
  if (m[2] === "pause") sub.status = "paused";
  if (m[2] === "resume") sub.status = "active";
  return json(res, 200, sub);
}).listen(rzpPort, "127.0.0.1");

createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const body = await read(req);
  if (control(p, req, body, res)) return;
  state.calls.push({ provider: "stripe", method: req.method, path: p, auth: req.headers.authorization, idem: req.headers["idempotency-key"], body });
  if (!req.headers.authorization?.startsWith("Bearer ")) return json(res, 401, { error: { type: "invalid_request_error", message: "auth" } });
  if (p === "/v1/checkout/sessions") return json(res, 200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_fake" });
  if (p === "/v1/billing_portal/sessions") return json(res, 200, { url: "https://billing.stripe.com/p/session/fake" });
  const m = /^\/v1\/subscriptions\/([^/]+)$/.exec(p);
  const sub = m && state.stripe[m[1]];
  if (!sub) return json(res, 404, { error: { type: "invalid_request_error", message: "No such subscription" } });
  if (req.method === "POST") {
    const f = new URLSearchParams(body);
    if (f.get("cancel_at_period_end") === "true") sub.cancel_at_period_end = true;
    if (f.get("pause_collection[behavior]")) sub.pause_collection = { behavior: f.get("pause_collection[behavior]") };
    if (f.get("pause_collection") === "") sub.pause_collection = null;
  }
  return json(res, 200, sub);
}).listen(stripePort, "127.0.0.1");
console.log("fake billing up");
