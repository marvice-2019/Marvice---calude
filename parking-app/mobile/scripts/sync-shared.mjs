// Copies the API types and pure helpers from ../web/lib into ./shared so web and app never drift.
// The repo isn't a monorepo yet; when it becomes one, move these into packages/shared and delete this script.
// Usage: npm run sync-shared        (writes)   |   node scripts/sync-shared.mjs --check   (CI: fails if stale)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["types.ts", "format.ts", "time.ts"];
const check = process.argv.includes("--check");
let stale = 0;
mkdirSync(join(root, "shared"), { recursive: true });
for (const f of FILES) {
  const src = join(root, "..", "web", "lib", f), dst = join(root, "shared", f);
  const body = `// GENERATED from parking-app/web/lib/${f} by scripts/sync-shared.mjs. Edit the web file, then run npm run sync-shared.\n` + readFileSync(src, "utf8");
  const same = existsSync(dst) && readFileSync(dst, "utf8") === body;
  if (check) { if (!same) { console.error(`stale: shared/${f}`); stale++; } }
  else if (!same) { writeFileSync(dst, body); console.log(`wrote shared/${f}`); }
}
if (stale) process.exit(1);
