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

// Welcome screen at the main address: "Full-Stack Video Generator" with five steps.
// (OpenMotion's / route opens the editor directly; its old home component is unused upstream.)
const welcome = await readFile(join(brandDir, "welcome.html"), "utf8");
await patch("studio/index.html", [
  ["<body>", `<body>\n${welcome}`],
  ["正在打开项目…", "Opening project…"],
]);

console.log("Branded OpenMotion as Marvice | Motion (English)");
