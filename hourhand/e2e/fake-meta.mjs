// A fake WhatsApp Cloud API for e2e. Usage: node e2e/fake-meta.mjs <port>
// POST /<version>/<phone-number-id>/messages records the message and answers with a wamid; GET /__state returns them.
import http from "node:http";

const [port] = process.argv.slice(2);
const messages = [];

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (req.url === "/__state") return send(200, { messages });
    if (req.method === "POST" && /^\/v[\d.]+\/[^/]+\/messages$/.test(req.url)) {
      if (req.headers.authorization !== "Bearer e2e-wa-access") return send(401, { error: { code: 190 } });
      messages.push(JSON.parse(body));
      return send(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.e2e.${messages.length}` }] });
    }
    send(404, { error: { code: 100 } });
  });
}).listen(Number(port), "127.0.0.1");
