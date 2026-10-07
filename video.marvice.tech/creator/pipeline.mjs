// One job = one prompt turned into one MP4. Jobs run one at a time because a
// render uses the whole machine. Each job lives in its own folder:
//   <CREATIONS_DIR>/<id>/job.json, index.html, assets/, renders/video.mp4
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { FOOTAGE_PROVIDERS, TEXT_PROVIDERS } from "./providers.mjs";
import {
  COMPOSITION_SYSTEM,
  FOOTAGE_SYSTEM,
  SIZES,
  compositionRequest,
  extractHtml,
  extractJson,
  footageRequest,
  repairRequest,
} from "./prompts.mjs";

const run = promisify(execFile);
const HYPERFRAMES = process.env.HYPERFRAMES_BIN || "hyperframes";
export const CREATIONS_DIR = process.env.CREATIONS_DIR || "/projects/creations";
const STUDIO_DIR = process.env.STUDIO_DIR || "/projects/studio";
const MAX_CLIPS = 3;

const jobs = new Map();
const queue = [];
let running = false;

export async function loadJobs() {
  await mkdir(CREATIONS_DIR, { recursive: true });
  for (const id of await readdir(CREATIONS_DIR)) {
    try {
      const job = JSON.parse(await readFile(join(CREATIONS_DIR, id, "job.json"), "utf8"));
      if (job.status !== "done" && job.status !== "failed") {
        job.status = "failed";
        job.error = "Interrupted by a server restart.";
      }
      jobs.set(job.id, job);
    } catch {
      // Not a job folder.
    }
  }
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getJob = (id) => jobs.get(id);

export async function createJob({ prompt, size, duration, text, footage }) {
  if (!prompt?.trim()) throw new Error("Type what the video should show.");
  if (!SIZES[size]) throw new Error("Unknown size.");
  if (!TEXT_PROVIDERS[text]?.enabled()) throw new Error("That AI model is not configured.");
  if (footage && !FOOTAGE_PROVIDERS[footage]?.enabled()) throw new Error("That footage AI is not configured.");
  const seconds = Math.min(Math.max(Number(duration) || 15, 4), 120);

  const createdAt = new Date().toISOString();
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
  const id = `${createdAt.slice(0, 19).replace(/[-:T]/g, "")}-${slug}`;
  const job = {
    id,
    prompt: prompt.trim(),
    size,
    duration: seconds,
    text,
    model: TEXT_PROVIDERS[text].model(),
    footage: footage || null,
    status: "queued",
    log: [],
    createdAt,
  };
  jobs.set(id, job);
  await mkdir(join(CREATIONS_DIR, id, "assets"), { recursive: true });
  await save(job);
  queue.push(id);
  void drain();
  return job;
}

// Copy a finished video's files into the Studio project so it can be edited
// there. The Studio folder is backed up by copy (Studio is watching it, so it
// is overwritten in place rather than moved).
export async function sendToStudio(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "done") throw new Error("Only finished videos can be opened in Studio.");
  if (existsSync(STUDIO_DIR)) {
    const backup = join(CREATIONS_DIR, "..", ".studio-backups", new Date().toISOString().replace(/[:.]/g, "-"));
    await cp(STUDIO_DIR, backup, { recursive: true });
  }
  await mkdir(STUDIO_DIR, { recursive: true });
  const dir = join(CREATIONS_DIR, id);
  await cp(join(dir, "index.html"), join(STUDIO_DIR, "index.html"));
  await cp(join(dir, "assets"), join(STUDIO_DIR, "assets"), { recursive: true });
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = jobs.get(queue.shift());
    try {
      await produce(job);
      job.status = "done";
      log(job, "Done.");
    } catch (err) {
      job.status = "failed";
      job.error = err.message;
      log(job, `Failed: ${err.message}`);
    }
    await save(job);
  }
  running = false;
}

async function produce(job) {
  const dir = join(CREATIONS_DIR, job.id);
  const writer = TEXT_PROVIDERS[job.text];
  const ask = (system, user) => writer.generate(system, user, job.model);
  const clips = [];

  if (job.footage) {
    const maker = FOOTAGE_PROVIDERS[job.footage];
    const shots = Math.min(MAX_CLIPS, Math.ceil(job.duration / maker.clipSeconds));
    await step(job, "planning", `Planning ${shots} footage shot(s) with ${writer.label}…`);
    const plan = extractJson(await ask(FOOTAGE_SYSTEM, footageRequest({ ...job, shots })));
    const prompts = (plan.shots ?? []).slice(0, shots);
    if (!prompts.length) throw new Error("No footage shots were planned.");
    for (const [i, prompt] of prompts.entries()) {
      const file = `clip-${i + 1}.mp4`;
      await step(job, "footage", `Generating footage ${i + 1}/${prompts.length} with ${maker.label}…`);
      await maker.generate({
        prompt,
        aspect: SIZES[job.size].footageAspect,
        outPath: join(dir, "assets", file),
        log: (msg) => log(job, msg),
      });
      clips.push({ file, prompt, seconds: maker.clipSeconds });
    }
  }

  await step(job, "writing", `Writing the video with ${writer.label} (${job.model})…`);
  let html = extractHtml(await ask(COMPOSITION_SYSTEM, compositionRequest({ ...job, clips })));
  await writeFile(join(dir, "index.html"), html);

  await step(job, "checking", "Checking the composition…");
  let errors = await lint(dir);
  if (errors.length) {
    log(job, `Fixing ${errors.length} problem(s): ${errors.map((e) => e.code).join(", ")}`);
    html = extractHtml(await ask(COMPOSITION_SYSTEM, repairRequest(html, errors)));
    await writeFile(join(dir, "index.html"), html);
    errors = await lint(dir);
    if (errors.length) {
      throw new Error(`The composition still has errors: ${errors.map((e) => e.message).join("; ")}`);
    }
  }

  await step(job, "rendering", "Rendering the MP4…");
  await run(HYPERFRAMES, ["render", dir, "-o", join(dir, "renders", "video.mp4")], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  }).catch((err) => {
    throw new Error(`Render failed: ${tail(err.stderr || err.stdout || err.message)}`);
  });
}

async function lint(dir) {
  let out;
  try {
    ({ stdout: out } = await run(HYPERFRAMES, ["lint", dir, "--json"], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    // lint exits non-zero when it finds errors but still prints its JSON.
    out = err.stdout;
    if (!out) throw new Error(`Validation failed to run: ${tail(err.stderr || err.message)}`);
  }
  const report = JSON.parse(out);
  return report.findings.filter((f) => f.severity === "error");
}

async function step(job, status, message) {
  job.status = status;
  log(job, message);
  await save(job);
}

function log(job, message) {
  job.log.push({ at: new Date().toISOString(), message });
}

const save = (job) => writeFile(join(CREATIONS_DIR, job.id, "job.json"), JSON.stringify(job, null, 2));

const tail = (text) => String(text).trim().split("\n").slice(-6).join(" | ");
