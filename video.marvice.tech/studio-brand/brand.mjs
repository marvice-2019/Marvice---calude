// Rebrands the HyperFrames Studio UI as "Marvice Editor Studio" (run at image build).
// The Studio server only serves its own files, so the logo and favicon are inlined
// into dist/studio/index.html as data URIs, together with a stylesheet and a script.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [studioDir, publicDir] = process.argv.slice(2);
const page = join(studioDir, "index.html");
const svg = async (name) =>
  `data:image/svg+xml;base64,${(await readFile(join(publicDir, name))).toString("base64")}`;
const logo = await svg("marvice-logo.svg");
const mark = await svg("marvice-mark.svg");
const css = await readFile(new URL("./brand.css", import.meta.url), "utf8");
const js = await readFile(new URL("./brand.js", import.meta.url), "utf8");

let html = await readFile(page, "utf8");
if (html.includes("marvice-brand")) process.exit(0);
const before = html;
html = html
  .replace(/<title>[^<]*<\/title>/, "<title>Marvice Editor Studio</title>")
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${mark}" />`)
  .replace(
    "</head>",
    `<style id="marvice-brand">:root{--marvice-logo:url("${logo}")}\n${css}</style>\n` +
      `<script>${js}</script>\n</head>`,
  );
if (html === before || !html.includes("Marvice Editor Studio")) {
  throw new Error("Studio index.html changed upstream; update studio-brand/brand.mjs");
}
await writeFile(page, html);
console.log("Branded", page);
