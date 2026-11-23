// Rebrands OpenMotion as "Marvice | Motion" and makes it English-only (run at image build,
// before `npm run build:studio`). Every patch must apply; if an upstream change moves the
// text, the build stops here instead of shipping a half-branded app.
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

const [app, brandDir] = process.argv.slice(2);

async function patch(file, edits) {
  const path = join(app, file);
  let text = await readFile(path, "utf8");
  for (const [from, to] of edits) {
    if (!text.includes(from)) throw new Error(`${file}: "${from}" not found; update openmotion/brand.mjs`);
    text = text.split(from).join(to);
  }
  await writeFile(path, text);
}

// Logo: Marvice wordmark + copper "MOTION", same look as the editor's "Marvice | Editor Studio".
// Kept at the 104x18 ratio OpenMotion's header and sidebar already reserve.
const wordmark = (await readFile(join(brandDir, "marvice-logo.svg"), "utf8"))
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
const INK = "rgb(17.64679%, 21.960449%, 21.568298%)";
const logo = (ink, rule) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Marvice Motion" viewBox="0 0 728 126">
<svg x="0" y="0" width="423" height="126" viewBox="221 217 423 126">${wordmark.split(INK).join(ink)}</svg>
<rect x="452" y="33" width="3" height="60" fill="${rule}"/>
<text x="484" y="82" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="46" font-weight="600" letter-spacing="7" fill="#BD8B53">MOTION</text>
</svg>
`;
// opendesign-dark.svg is shown on the light theme, opendesign-light.svg on the dark theme.
await writeFile(join(app, "web/design-system/opendesign-dark.svg"), logo(INK, "#D5CFC6"));
await writeFile(join(app, "web/design-system/opendesign-light.svg"), logo("#F2EEE8", "#4A5453"));
await copyFile(join(brandDir, "marvice-mark.svg"), join(app, "studio/public/favicon.svg"));
for (const file of ["studio/src/motion/WorkspaceFrame.tsx", "studio/src/motion/MotionStudioHost.tsx"])
  await patch(file, [['alt="OpenDesign"', 'alt="Marvice Motion"']]);

await patch("studio/index.html", [
  ['lang="zh-CN"', 'lang="en"'],
  ["<title>OpenMotion 工作室</title>", "<title>Marvice | Motion</title>"],
]);
await patch("web/connect.html", [["<strong>OpenMotion</strong>", "<strong>Marvice Motion</strong>"]]);

await patch("workspace.ts", [["title: '初始工程'", "title: 'First project'"]]);

// English by default; Chinese is ignored if saved and removed from the language menu.
await patch("studio/src/i18n/I18n.tsx", [
  ["if (isLocale(saved)) return saved;", "if (isLocale(saved) && saved !== 'zh-CN') return saved;"],
  ["return 'zh-CN';\n}", "return 'en';\n}"],
]);
// Server side: the home template grid asks without a locale, which upstream treats as Chinese.
await patch("server.ts", [["locale: url.searchParams.get('locale') || undefined,", "locale: url.searchParams.get('locale') || 'en',"]]);
await patch("shared/integration.ts", [
  ["locale: 'zh-CN' | 'en' = 'zh-CN')", "locale: 'zh-CN' | 'en' = 'en')"],
  ["locale = 'zh-CN')", "locale = 'en')"],
]);
await patch("studio/src/i18n/LanguageMenu.tsx", [
  ["{languages.map(", "{languages.filter(language => language.locale !== 'zh-CN').map("],
]);

// Realistic photo and video models on fal.ai (needs FAL_KEY). IDs and options checked against
// fal's catalogue and OpenAPI schemas on 2026-11-12; Veo is deprecated on fal, so Kling 4.0 is the video pick.
await patch("gateway/catalog.ts", [["export const builtinModels: Model[] = [", `export const builtinModels: Model[] = [
  { ...builtin('fal', 'fal-ai/flux-pro/v1.1-ultra', 'FLUX 1.1 Pro Ultra (realistic photo)', 'image', 'text-to-image'), defaults: { raw: true, output_format: 'jpeg' } },
  { ...builtin('fal', 'fal-ai/nano-banana-pro', 'Nano Banana Pro', 'image', 'text-to-image'), defaults: { resolution: '2K' } },
  { ...builtin('fal', 'kling/v4/text-to-video', 'Kling 4.0 (realistic video, 1080p)', 'video', 'text-to-video'), defaults: { resolution: '1080p' } },
  builtin('fal', 'kling/v4/flash/text-to-video', 'Kling 4.0 Flash (faster, 720p)', 'video', 'text-to-video'),`]]);
// Free photo generation: Cloudflare Workers AI (10,000 free neurons/day per account; checked 2026-11-12).
// Key is "<account id>:<API token>" (Model settings / welcome screen), or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
await patch("shared/gateway.ts", [["export type ProviderId = 'codex' | 'atlascloud' | 'fal';", "export type ProviderId = 'codex' | 'atlascloud' | 'fal' | 'cloudflare';"]]);
await patch("gateway/catalog.ts", [
  ["fal: 'fal.ai' };", "fal: 'fal.ai', cloudflare: 'Cloudflare Workers AI' };"],
  ["export const builtinModels: Model[] = [", `export const builtinModels: Model[] = [
  builtin('cloudflare', '@cf/black-forest-labs/flux-2-klein-4b', 'FLUX.2 Klein (free, Cloudflare)', 'image', 'text-to-image'),
  builtin('cloudflare', '@cf/leonardo/lucid-origin', 'Lucid Origin (photoreal, free ~2/day, Cloudflare)', 'image', 'text-to-image'),
  builtin('cloudflare', '@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 Schnell (free, square, Cloudflare)', 'image', 'text-to-image'),`],
]);
await patch("gateway/service.ts", [["id === 'fal' ? process.env.FAL_KEY : undefined;",
  "id === 'fal' ? process.env.FAL_KEY : id === 'cloudflare' && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN ? process.env.CLOUDFLARE_ACCOUNT_ID + ':' + process.env.CLOUDFLARE_API_TOKEN : undefined;"]]);
await patch("gateway/providers.ts", [["export const providerAdapters: Record<'atlascloud' | 'fal', ProviderAdapter> = { atlascloud: atlas, fal };", `/** Cloudflare Workers AI. Key: "<account id>:<API token>". Returns the image inline (base64). */
const CF_SIZES: Record<string, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1024, 1024], '4:3': [1024, 768], '3:4': [768, 1024] };
const cloudflare: ProviderAdapter = {
  async generate(job, ctx) {
    const split = ctx.key.indexOf(':'), account = ctx.key.slice(0, split), token = ctx.key.slice(split + 1);
    if (split < 1 || !/^[a-f0-9]{32}$/.test(account) || !token) throw new ProviderError('Cloudflare key must be "<account id>:<API token>"', 401);
    const { aspect_ratio, ...rest } = { ...job.model.defaults, ...job.parameters } as Record<string, unknown>;
    const [width, height] = CF_SIZES[String(aspect_ratio)] ?? CF_SIZES['1:1'];
    const headers: Record<string, string> = { Authorization: \`Bearer \${token}\` };
    let body;
    if (job.model.modelId.includes('flux-2-klein')) {
      body = new FormData(); body.append('prompt', job.prompt); body.append('width', String(width)); body.append('height', String(height));
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(job.model.modelId.includes('flux-1-schnell') ? { steps: 8, ...rest, prompt: job.prompt } : { width, height, ...rest, prompt: job.prompt });
    }
    await ctx.progress('generating');
    let result;
    try { result = await apiJson(ctx.fetcher, \`https://api.cloudflare.com/client/v4/accounts/\${account}/ai/run/\${job.model.modelId}\`, { method: 'POST', headers, body, signal: ctx.signal }); }
    catch (error) {
      if (error instanceof ProviderError && error.status === 429) throw new Error('Cloudflare free daily allowance used up (resets 00:00 UTC) or rate limited; try later or pick a cheaper model');
      throw error;
    }
    const image = result?.result?.image;
    if (typeof image !== 'string' || !image) throw new Error('Cloudflare returned no image');
    return [\`data:image/jpeg;base64,\${image}\`];
  },
};
export const providerAdapters: Record<'atlascloud' | 'fal' | 'cloudflare', ProviderAdapter> = { atlascloud: atlas, fal, cloudflare };`]]);
// The editor's generator: pass shape to Cloudflare models.
await patch("studio/src/motion/MediaGenerator.tsx", [["  if (model.provider === 'codex') return { aspect_ratio: ratio, ...extra };",
  "  if (model.provider === 'codex' || model.provider === 'cloudflare') return { aspect_ratio: ratio, ...extra };"]]);

// The editor's generator: pass shape and length to those models.
await patch("studio/src/motion/MediaGenerator.tsx", [["  if (model.provider === 'fal' && model.modelId.startsWith('fal-ai/flux/'))", `  if (model.provider === 'fal' && ['fal-ai/flux-pro/v1.1-ultra', 'fal-ai/nano-banana-pro'].includes(model.modelId)) return { aspect_ratio: ratio, ...extra };
  if (model.provider === 'fal' && model.modelId.startsWith('kling/v4/')) return { aspect_ratio: ratio, duration: Math.min(15, Math.max(3, Math.round(duration))), ...extra };
  if (model.provider === 'fal' && model.modelId.startsWith('fal-ai/flux/'))`]]);

// Welcome screen at the main address: "Full-Stack Video Generator" with five steps.
// (OpenMotion's / route opens the editor directly; its old home component is unused upstream.)
const welcome = await readFile(join(brandDir, "welcome.html"), "utf8");
await patch("studio/index.html", [
  ["<body>", `<body>\n${welcome}`],
  ["正在打开项目…", "Opening project…"],
]);

console.log("Branded OpenMotion as Marvice | Motion (English)");
