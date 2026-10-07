// AI providers. Text providers write the HyperFrames composition; footage
// providers generate video clips from a prompt. A provider is offered in the
// UI only when its API key (and, for OpenRouter, its model) is configured.
import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";

const env = process.env;

export const TEXT_PROVIDERS = {
  claude: {
    label: "Claude (Anthropic)",
    enabled: () => Boolean(env.ANTHROPIC_API_KEY),
    model: () => env.ANTHROPIC_MODEL || "claude-opus-5-5",
    generate: generateClaude,
  },
  openai: {
    label: "OpenAI",
    enabled: () => Boolean(env.OPENAI_API_KEY),
    model: () => env.OPENAI_MODEL || "gpt-5",
    generate: (system, user, model) =>
      generateOpenAICompatible(
        env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        env.OPENAI_API_KEY,
        system,
        user,
        model,
      ),
  },
  gemini: {
    label: "Gemini (Google)",
    enabled: () => Boolean(env.GEMINI_API_KEY),
    model: () => env.GEMINI_MODEL || "gemini-2.5-pro",
    generate: generateGemini,
  },
  openrouter: {
    label: "Other models (OpenRouter)",
    enabled: () => Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL),
    model: () => env.OPENROUTER_MODEL,
    generate: (system, user, model) =>
      generateOpenAICompatible("https://openrouter.ai/api/v1", env.OPENROUTER_API_KEY, system, user, model),
  },
};

export const FOOTAGE_PROVIDERS = {
  veo: {
    label: "Google Veo",
    enabled: () => Boolean(env.GEMINI_API_KEY),
    clipSeconds: 8,
    generate: generateVeo,
  },
  sora: {
    label: "OpenAI Sora",
    enabled: () => Boolean(env.OPENAI_API_KEY),
    clipSeconds: 8,
    generate: generateSora,
  },
};

export function availableProviders() {
  const list = (all) =>
    Object.entries(all)
      .filter(([, p]) => p.enabled())
      .map(([id, p]) => ({ id, label: p.label, model: p.model?.() }));
  return { text: list(TEXT_PROVIDERS), footage: list(FOOTAGE_PROVIDERS) };
}

async function generateClaude(system, user, model) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Streaming keeps a long HTML answer from hitting HTTP timeouts. `fallbacks:
  // "default"` re-runs a request a safety classifier declines on Anthropic's
  // recommended fallback model instead of failing the job.
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: env.ANTHROPIC_EFFORT || "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined this prompt. Try rewording it.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Claude's answer was cut off (max_tokens). Try a shorter video.");
  }
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function generateOpenAICompatible(baseUrl, apiKey, system, user, model) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await readJson(res, "Text model");
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error("Text model returned no content.");
  return choice.message.content;
}

async function generateGemini(system, user, model) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
      }),
    },
  );
  const data = await readJson(res, "Gemini");
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no content.");
  return text;
}

// Veo through the Gemini API: start a long-running operation, poll it, then
// download the clip. Veo only makes 16:9 and 9:16; other sizes are cropped.
async function generateVeo({ prompt, aspect, outPath, log }) {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const headers = { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
  const model = env.VEO_MODEL || "veo-3.0-generate-001";
  const start = await fetch(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: aspect === "portrait" ? "9:16" : "16:9" },
    }),
  });
  let op = await readJson(start, "Veo");
  while (!op.done) {
    log("Veo is generating the clip…");
    await sleep(10_000);
    op = await readJson(await fetch(`${base}/${op.name}`, { headers }), "Veo");
  }
  if (op.error) throw new Error(`Veo failed: ${op.error.message ?? JSON.stringify(op.error)}`);
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("Veo finished without a video (it may have been filtered).");
  await download(uri, { "x-goog-api-key": env.GEMINI_API_KEY }, outPath);
}

// Sora through the OpenAI Videos API.
async function generateSora({ prompt, aspect, outPath, log }) {
  const base = "https://api.openai.com/v1/videos";
  const auth = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  const start = await fetch(base, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.SORA_MODEL || "sora-2",
      prompt,
      size: aspect === "portrait" ? "720x1280" : "1280x720",
      seconds: "8",
    }),
  });
  let job = await readJson(start, "Sora");
  while (job.status === "queued" || job.status === "in_progress") {
    log(`Sora is generating the clip… ${job.progress ?? 0}%`);
    await sleep(10_000);
    job = await readJson(await fetch(`${base}/${job.id}`, { headers: auth }), "Sora");
  }
  if (job.status !== "completed") {
    throw new Error(`Sora failed: ${job.error?.message ?? job.status}`);
  }
  await download(`${base}/${job.id}/content`, auth, outPath);
}

async function download(url, headers, outPath) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`Clip download failed: HTTP ${res.status}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

async function readJson(res, who) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${who}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`${who}: HTTP ${res.status} ${data.error?.message ?? text.slice(0, 300)}`);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
