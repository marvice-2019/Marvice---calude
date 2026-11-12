// Renames project and conversation titles that contain Chinese to English (runs at container start,
// before the editor). Only titles with Chinese characters change, so running it again is a no-op.
// "初始工程" (OpenMotion's old default) becomes "First project"; any other becomes "Project N",
// keeping a trailing number when the title has one.
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

const file = join(process.env.MOTION_DATA_DIR || "/data", "projects.json");
let catalog;
try { catalog = JSON.parse(await readFile(file, "utf8")); }
catch (error) { if (error.code === "ENOENT") process.exit(0); throw error; }

const chinese = /[　-〿㐀-鿿＀-￯]/;
const known = { "初始工程": "First project" };
const renamed = new Map();
const english = (title, index) => {
  if (renamed.has(title)) return renamed.get(title);
  const number = title.match(/(\d+)\s*$/);
  const name = known[title.trim()] || `Project ${number ? number[1] : index + 1}`;
  renamed.set(title, name);
  return name;
};

let changes = 0;
for (const list of [catalog.projects, catalog.sessions]) {
  (list || []).forEach((item, index) => {
    if (typeof item.title === "string" && chinese.test(item.title)) { item.title = english(item.title, index); changes++; }
    for (const artifact of item.artifacts || [])
      if (typeof artifact.title === "string" && chinese.test(artifact.title)) { artifact.title = english(artifact.title, index); changes++; }
  });
}
if (!changes) process.exit(0);
const temporary = file + ".rename-" + process.pid;
await writeFile(temporary, JSON.stringify(catalog), { mode: 0o600 });
await rename(temporary, file);
console.log(`Renamed ${changes} Chinese project/conversation titles to English`);
