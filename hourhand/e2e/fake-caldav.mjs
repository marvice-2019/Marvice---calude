// A fake iCloud CalDAV server for e2e. Usage: node e2e/fake-caldav.mjs <port>
// Apple ID any, app-specific password "good-pass-1234". POST /__busy {start,end} adds a busy event; POST /__fail401 makes every
// authenticated call answer 401; GET /__state returns the stored events and the request log.
import http from "node:http";

const [port] = process.argv.slice(2);
const PASSWORD = "good-pass-1234";
const events = new Map(); // uid -> ics
const busy = [];
const log = [];
let fail401 = false;
const ms = (inner) => `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${inner}</d:multistatus>`;
const ics = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const send = (status, text = "", type = "application/xml") => { res.writeHead(status, { "content-type": type }); res.end(text); };
    if (url.pathname === "/__state") return send(200, JSON.stringify({ events: Object.fromEntries(events), log }), "application/json");
    if (url.pathname === "/__busy") { busy.push(JSON.parse(body)); return send(200, "{}"); }
    if (url.pathname === "/__fail401") { fail401 = true; return send(200, "{}"); }
    log.push({ method: req.method, path: url.pathname });
    const pw = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":");
    if (fail401 || pw !== PASSWORD) return send(401, "unauthorized");
    if (req.method === "PROPFIND" && url.pathname === "/") return send(207, ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/p/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`));
    if (req.method === "PROPFIND" && url.pathname === "/p/") return send(207, ms(`<d:response><d:href>/p/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/cal/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`));
    if (req.method === "PROPFIND" && url.pathname === "/cal/") return send(207, ms(
      `<d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
      `<d:response><d:href>/cal/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>` +
      `<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><cs:getctag>1</cs:getctag></d:prop></d:propstat></d:response>`));
    if (req.method === "REPORT" && url.pathname === "/cal/work/") {
      const all = [...busy.map((b, i) => `BEGIN:VEVENT\r\nUID:busy-${i}\r\nDTSTART:${utc(b.start)}\r\nDTEND:${utc(b.end)}\r\nEND:VEVENT\r\n`)];
      return send(207, ms(all.map((e, i) => `<d:response><d:href>/cal/work/e${i}.ics</d:href><d:propstat><d:prop><c:calendar-data>${ics(e)}</c:calendar-data></d:prop></d:propstat></d:response>`).join("")));
    }
    const m = /^\/cal\/work\/(.+)\.ics$/.exec(url.pathname);
    if (m) {
      const uid = decodeURIComponent(m[1]);
      if (req.method === "PUT") { if (req.headers["if-none-match"] === "*" && events.has(uid)) return send(412); events.set(uid, body); return send(201); }
      if (req.method === "GET") return events.has(uid) ? send(200, events.get(uid), "text/calendar") : send(404);
      if (req.method === "DELETE") return events.delete(uid) ? send(204) : send(404);
    }
    send(404);
  });
}).listen(Number(port), "127.0.0.1");
