// HTTP front end for the prompt-to-video creator, served under /create.
// The Caddy gate in front of it handles the login.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { availableProviders } from "./providers.mjs";
import { CREATIONS_DIR, createJob, getJob, listJobs, loadJobs, sendToStudio } from "./pipeline.mjs";
import { DURATIONS, SIZES } from "./prompts.mjs";

const PORT = Number(process.env.PORT || 4000);
const PAGE = fileURLToPath(new URL("./public/index.html", import.meta.url));
const FILES = { "video.mp4": ["renders/video.mp4", "video/mp4"], "index.html": ["index.html", "text/html"] };

const routes = [
  ["GET", /^\/create\/?$/, async (req, res) => send(res, 200, await readFile(PAGE), "text/html; charset=utf-8")],
  ["GET", /^\/create\/assets\/(marvice-logo\.svg|marvice-mark\.svg)$/, async (req, res, name) =>
    send(res, 200, await readFile(new URL(`./public/${name}`, import.meta.url)), "image/svg+xml")],
  ["GET", /^\/create\/api\/options$/, (req, res) =>
    json(res, 200, { providers: availableProviders(), sizes: SIZES, durations: DURATIONS })],
  ["GET", /^\/create\/api\/jobs$/, (req, res) => json(res, 200, listJobs())],
  ["POST", /^\/create\/api\/jobs$/, async (req, res) => json(res, 201, await createJob(await body(req)))],
  ["GET", /^\/create\/api\/jobs\/([\w-]+)$/, (req, res, id) => {
    const job = getJob(id);
    return job ? json(res, 200, job) : json(res, 404, { error: "Not found." });
  }],
  ["POST", /^\/create\/api\/jobs\/([\w-]+)\/studio$/, async (req, res, id) => {
    await sendToStudio(id);
    json(res, 200, { ok: true });
  }],
  ["GET", /^\/create\/files\/([\w-]+)\/(video\.mp4|index\.html)$/, (req, res, id, name) => {
    if (!getJob(id)) return json(res, 404, { error: "Not found." });
    const [rel, type] = FILES[name];
    const path = join(CREATIONS_DIR, id, rel);
    if (!existsSync(path)) return json(res, 404, { error: "Not ready." });
    const download = new URL(req.url, "http://x").searchParams.has("download");
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": statSync(path).size,
      ...(download && { "Content-Disposition": `attachment; filename="${id}-${name}"` }),
      // Generated HTML is downloaded or viewed, never run with this site's origin.
      ...(name === "index.html" && { "Content-Security-Policy": "sandbox" }),
    });
    createReadStream(path).pipe(res);
  }],
];

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  for (const [method, pattern, handler] of routes) {
    const match = req.method === method && path.match(pattern);
    if (match) {
      try {
        await handler(req, res, ...match.slice(1));
      } catch (err) {
        json(res, 400, { error: err.message });
      }
      return;
    }
  }
  json(res, 404, { error: "Not found." });
}).listen(PORT, async () => {
  await loadJobs();
  console.log(`creator listening on :${PORT}`);
});

function send(res, status, data, type) {
  res.writeHead(status, { "Content-Type": type });
  res.end(data);
}

const json = (res, status, data) => send(res, status, JSON.stringify(data), "application/json");

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("Request too large.");
  }
  return JSON.parse(raw || "{}");
}
