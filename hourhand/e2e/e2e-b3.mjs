// B3 end to end against the local server only. Usage: node e2e/e2e-b3.mjs <port> <server-log> <database-url>
import { readFileSync } from "node:fs";
import pg from "pg";

const [port, logPath, databaseUrl] = process.argv.slice(2);
const B = `http://localhost:${port}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);
const log = () => readFileSync(logPath, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(200); } return pred(); }

await sleep(2500);
check(log().includes("[jobs] runner started (log only"), "job runner started with the server");

const pool = new pg.Pool({ connectionString: databaseUrl });
const pq = await pool.query("select q.id from custom_questions q join event_types e on e.id = q.event_type_id where e.slug = 'coaching'");
const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
const slots = (await (await fetch(`${B}/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`, { signal: t() })).json()).slots;
const email = `b3-${Date.now()}@example.com`;
const before = Date.now();
const res = await fetch(`${B}/api/bookings`, {
  method: "POST", headers: { "content-type": "application/json" }, signal: t(),
  body: JSON.stringify({ slug: "priya", event: "coaching", start: slots.at(-1), name: "Kiran Rao", email, timezone: "Europe/London", answers: { [pq.rows[0].id]: "Plan" }, idempotencyKey: `e2e-b3-${Date.now()}` }),
});
const booked = await res.json();
check(res.status === 201, `booking -> ${res.status}`);
const gotGuest = await waitFor(() => log().includes(`[dev] email to ${email}: Booked:`));
check(gotGuest, `guest confirmation sent within ${((Date.now() - before) / 1000).toFixed(1)}s (kicked, not waiting for the 15s poll)`);
check(await waitFor(() => /\[dev\] email to priya@[^:]+: New booking: Kiran Rao/.test(log())), "host notice sent");
check(log().includes(`/b/${booked.manageToken}`), "guest email carries the manage link");

const { rows } = await pool.query(
  "select n.kind, n.status from notifications n join invitees i on i.booking_id = n.booking_id where i.email = $1 order by n.kind", [email]);
check(rows.filter((r) => r.status === "sent").length === 2 && rows.filter((r) => r.kind === "reminder_guest" && r.status === "queued").length >= 1,
  `queue after booking: ${rows.map((r) => `${r.kind}=${r.status}`).join(", ")}`);

const cancel = await fetch(`${B}/api/b/${booked.manageToken}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Clash" }), signal: t() });
check(cancel.status === 200, `guest cancels -> ${cancel.status}`);
check(await waitFor(() => log().includes(`[dev] email to ${email}: Cancelled:`)), "guest cancellation sent");
check(await waitFor(() => /\[dev\] email to priya@[^:]+: Cancelled: Kiran Rao/.test(log())), "host cancellation sent");
const after = await pool.query(
  "select n.kind, n.status from notifications n join invitees i on i.booking_id = n.booking_id where i.email = $1 and n.kind = 'reminder_guest'", [email]);
check(after.rows.every((r) => r.status === "skipped"), `reminders after cancel: ${after.rows.map((r) => r.status).join(", ")}`);
await pool.end();
process.exit(fail ? 1 : 0);
