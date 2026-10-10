// AI providers. Text providers write the HyperFrames composition; footage
// providers generate video clips from a prompt. A provider is offered in the
// UI only when its API key (and, for OpenRouter, its model) is configured.
import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";

const env = process.env;

// "<X>_MODEL" may hold one model or a comma-separated list; those come first,
// then the built-in choices. Each entry is { id, label }.
function modelList(envValue, defaults) {
  const custom = (envValue || "").split(",").map((m) => m.trim()).filter(Boolean).map((id) => ({ id, label: id }));
  const seen = new Set();
  return [...custom, ...defaults].filter((m) => !seen.has(m.id) && seen.add(m.id));
}

const has = (...keys) => keys.some((k) => Boolean(env[k]));
const falKey = () => env.FAL_KEY || env.FAL_AI_API_KEY;

const openAICompatible = (baseUrl, keyName) => (system, user, model) =>
  generateOpenAICompatible(typeof baseUrl === "function" ? baseUrl() : baseUrl, env[keyName], system, user, model);

export const TEXT_PROVIDERS = {
  claude: {
    label: "Claude (Anthropic)",
    keys: ["ANTHROPIC_API_KEY"],
    models: () => modelList(env.ANTHROPIC_MODEL, [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable)" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
    ]),
    generate: generateClaude,
  },
  openai: {
    label: "OpenAI",
    keys: ["OPENAI_API_KEY"],
    models: () => modelList(env.OPENAI_MODEL, [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini (fastest)" },
    ]),
    generate: openAICompatible(() => env.OPENAI_BASE_URL || "https://api.openai.com/v1", "OPENAI_API_KEY"),
  },
  gemini: {
    label: "Gemini (Google)",
    keys: ["GEMINI_API_KEY"],
    models: () => modelList(env.GEMINI_MODEL, [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (paid tier)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ]),
    generate: generateGemini,
  },
  xai: {
    label: "Grok (xAI)",
    keys: ["XAI_API_KEY"],
    models: () => modelList(env.XAI_MODEL, [{ id: "grok-4", label: "Grok 4" }]),
    generate: openAICompatible("https://api.x.ai/v1", "XAI_API_KEY"),
  },
  deepseek: {
    label: "DeepSeek",
    keys: ["DEEPSEEK_API_KEY"],
    models: () => modelList(env.DEEPSEEK_MODEL, [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ]),
    generate: openAICompatible("https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"),
  },
  mistral: {
    label: "Mistral",
    keys: ["MISTRAL_API_KEY"],
    models: () => modelList(env.MISTRAL_MODEL, [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-medium-latest", label: "Mistral Medium" },
    ]),
    generate: openAICompatible("https://api.mistral.ai/v1", "MISTRAL_API_KEY"),
  },
  openrouter: {
    label: "Other models (OpenRouter)",
    keys: ["OPENROUTER_API_KEY"],
    // OpenRouter has hundreds of models, so only the ones listed in OPENROUTER_MODEL are offered.
    models: () => modelList(env.OPENROUTER_MODEL, []),
    generate: openAICompatible("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
  },
};

// fal.ai hosts many video models behind one key (FAL_KEY). `body` builds the
// model-specific request; every model is asked for 16:9 or 9:16.
const FAL_MODELS = [
  { id: "fal-ai/kling-video/v3/standard/text-to-video", label: "Kling 3", clipSeconds: 10,
    body: (prompt, ratio) => ({ prompt, aspect_ratio: ratio, duration: "10" }) },
  { id: "fal-ai/minimax/hailuo-03/text-to-video", label: "MiniMax Hailuo 03", clipSeconds: 10,
    body: (prompt, ratio) => ({ prompt, aspect_ratio: ratio, duration: 10 }) },
  { id: "bytedance/seedance-2.5/text-to-video", label: "Seedance 2.5", clipSeconds: 10,
    body: (prompt, ratio) => ({ prompt, aspect_ratio: ratio, duration: "10" }) },
  { id: "bytedance/seedance-2.0/fast/text-to-video", label: "Seedance 2.0 Fast", clipSeconds: 10,
    body: (prompt, ratio) => ({ prompt, aspect_ratio: ratio, duration: "10" }) },
];

export const FOOTAGE_PROVIDERS = {
  veo: {
    label: "Google Veo",
    keys: ["GEMINI_API_KEY"],
    models: () => modelList(env.VEO_MODEL, [
      { id: "veo-3.1-generate-preview", label: "Veo 3.1" },
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast" },
      { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite" },
    ]).map((m) => ({ ...m, clipSeconds: 8 })),
    generate: generateVeo,
  },
  sora: {
    label: "OpenAI Sora",
    keys: ["OPENAI_API_KEY"],
    models: () => modelList(env.SORA_MODEL, [
      { id: "sora-2", label: "Sora 2" },
      { id: "sora-2-pro", label: "Sora 2 Pro" },
    ]).map((m) => ({ ...m, clipSeconds: 8 })),
    generate: generateSora,
  },
  grok: {
    label: "Grok Imagine (xAI)",
    keys: ["XAI_API_KEY"],
    models: () => [{ id: "grok-imagine-video", label: "Grok Imagine Video", clipSeconds: 8 }],
    generate: generateGrokVideo,
  },
  fal: {
    label: "fal.ai",
    keys: ["FAL_KEY", "FAL_AI_API_KEY"],
    models: () => FAL_MODELS.map(({ id, label, clipSeconds }) => ({ id, label, clipSeconds })),
    generate: generateFal,
  },
};

const isEnabled = (p) => has(...p.keys) && p.models().length > 0;

export function enabledModel(all, providerId, modelId) {
  const provider = all[providerId];
  if (!provider || !isEnabled(provider)) return null;
  const models = provider.models();
  return modelId ? models.find((m) => m.id === modelId) ?? null : models[0];
}

// Every provider is listed so the UI can show what each key unlocks; `enabled`
// says whether it can be used now.
export function availableProviders() {
  const list = (all) =>
    Object.entries(all).map(([id, p]) => ({
      id,
      label: p.label,
      enabled: isEnabled(p),
      needs: id === "openrouter" ? "OPENROUTER_API_KEY + OPENROUTER_MODEL" : p.keys[0],
      models: p.models().map(({ id, label, clipSeconds }) => ({ id, label, clipSeconds })),
    }));
  return { text: list(TEXT_PROVIDERS), footage: list(FOOTAGE_PROVIDERS) };
}

async function generateClaude(system, user, model) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Streaming keeps a long HTML answer from hitting HTTP timeouts. `fallbacks:
  // "default"` re-runs a request a safety classifier declines on Anthropic's
  // recommended fallback model instead of failing the job. Haiku 4.5 supports
  // neither adaptive thinking, effort nor fallbacks, so it gets a plain request.
  const haiku = model.startsWith("claude-haiku");
  const stream = client.beta.messages.stream({
    model,
    max_tokens: haiku ? 32000 : 64000,
    ...(!haiku && {
      thinking: { type: "adaptive" },
      output_config: { effort: env.ANTHROPIC_EFFORT || "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }),
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
async function generateVeo({ prompt, aspect, model, outPath, log }) {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const headers = { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
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
async function generateSora({ prompt, aspect, model, outPath, log }) {
  const base = "https://api.openai.com/v1/videos";
  const auth = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  const start = await fetch(base, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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

// Grok Imagine through the xAI Videos API.
async function generateGrokVideo({ prompt, aspect, model, outPath, log }) {
  const auth = { Authorization: `Bearer ${env.XAI_API_KEY}` };
  const start = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, duration: 8, aspect_ratio: ratio(aspect), resolution: "720p" }),
  });
  const { request_id: id } = await readJson(start, "Grok");
  let job;
  do {
    log("Grok is generating the clip…");
    await sleep(10_000);
    job = await readJson(await fetch(`https://api.x.ai/v1/videos/${id}`, { headers: auth }), "Grok");
    if (job.status === "failed" || job.status === "expired") {
      throw new Error(`Grok failed: ${job.error?.message ?? job.error ?? job.status}`);
    }
  } while (job.status !== "done");
  if (!job.video?.url) throw new Error("Grok finished without a video.");
  await download(job.video.url, {}, outPath);
}

// fal.ai queue API: submit, poll the status URL, then read the result.
async function generateFal({ prompt, aspect, model, outPath, log }) {
  const spec = FAL_MODELS.find((m) => m.id === model);
  const auth = { Authorization: `Key ${falKey()}` };
  const start = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(spec.body(prompt, ratio(aspect))),
  });
  const queued = await readJson(start, spec.label);
  let status;
  do {
    log(`${spec.label} is generating the clip…`);
    await sleep(10_000);
    status = await readJson(await fetch(queued.status_url, { headers: auth }), spec.label);
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      throw new Error(`${spec.label} failed: ${status.error ?? status.status}`);
    }
  } while (status.status !== "COMPLETED");
  const result = await readJson(await fetch(queued.response_url, { headers: auth }), spec.label);
  if (!result.video?.url) throw new Error(`${spec.label} finished without a video.`);
  await download(result.video.url, {}, outPath);
}

const ratio = (aspect) => (aspect === "portrait" ? "9:16" : "16:9");

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
