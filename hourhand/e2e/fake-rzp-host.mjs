// A fake of the host-side Razorpay API (orders, payments, refunds) for the B5b e2e run. Usage: node e2e/fake-rzp-host.mjs <port>
// The one key pair it accepts is rzp_test_e2ehost1234 / e2e-host-key; anything else gets 401.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const KEY_ID = "rzp_test_e2ehost1234";
const KEY_VALUE = "e2e-host-key";
const GOOD = `Basic ${Buffer.from(`${KEY_ID}:${KEY_VALUE}`).toString("base64")}`;
const state = { orders: {}, payments: {}, refunds: {}, calls: [] };
let n = 0;
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const err = (res, status, description) => json(res, status, { error: { code: "BAD_REQUEST_ERROR", description } });

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const body = await read(req);
  if (p === "/__state") return json(res, 200, state);
  // Test control: a guest pays an order. Returns what Checkout would hand the browser, signature included.
  if (p === "/__pay" && req.method === "POST") {
    const { orderId, status = "captured" } = JSON.parse(body);
    const o = state.orders[orderId];
    if (!o) return err(res, 404, "no order");
    const id = `pay_e2e${++n}`;
    state.payments[id] = { id, order_id: orderId, amount: o.amount, currency: o.currency, status };
    if (status === "captured") o.status = "paid";
    const signature = createHmac("sha256", KEY_VALUE).update(`${orderId}|${id}`).digest("hex");
    return json(res, 200, { razorpay_payment_id: id, razorpay_order_id: orderId, razorpay_signature: signature });
  }
  state.calls.push(`${req.method} ${p}`);
  if (req.headers.authorization !== GOOD) return json(res, 401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
  if (p === "/v1/orders" && req.method === "GET") return json(res, 200, { entity: "collection", count: 0, items: [] });
  if (p === "/v1/orders" && req.method === "POST") {
    const b = JSON.parse(body);
    const id = `order_e2e${++n}`;
    state.orders[id] = { id, amount: b.amount, currency: b.currency, receipt: b.receipt, notes: b.notes, status: "created" };
    return json(res, 200, state.orders[id]);
  }
  let m = /^\/v1\/orders\/([^/]+)\/payments$/.exec(p);
  if (m) return json(res, 200, { entity: "collection", items: Object.values(state.payments).filter((x) => x.order_id === m[1]) });
  m = /^\/v1\/payments\/([^/]+)(?:\/(capture|refund|refunds))?$/.exec(p);
  if (m) {
    const pay = state.payments[m[1]];
    if (!pay) return err(res, 400, "The id provided does not exist");
    if (m[2] === "capture") { pay.status = "captured"; state.orders[pay.order_id].status = "paid"; return json(res, 200, pay); }
    if (m[2] === "refunds") return json(res, 200, { entity: "collection", items: Object.values(state.refunds).filter((r) => r.payment_id === pay.id) });
    if (m[2] === "refund") {
      const b = JSON.parse(body || "{}");
      if (Object.values(state.refunds).some((r) => r.receipt === b.receipt)) return err(res, 400, "Duplicate receipt found for this refund request");
      const id = `rfnd_e2e${++n}`;
      state.refunds[id] = { id, payment_id: pay.id, amount: b.amount ?? pay.amount, receipt: b.receipt, status: "processed" };
      pay.status = "refunded";
      return json(res, 200, state.refunds[id]);
    }
    return json(res, 200, pay);
  }
  return err(res, 404, `no route ${p}`);
}).listen(port, "127.0.0.1");
console.log("fake razorpay (host) up");
