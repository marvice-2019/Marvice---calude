// Bundles the ops scripts (migrate, seed, retention, photo import) into plain .mjs files
// for the production image, where tsx and devDependencies are not installed.
// Native packages stay external: Next's standalone output already ships them in node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["scripts/migrate.ts", "scripts/seed.ts", "scripts/retention.ts", "scripts/import-photos.ts"],
  outdir: "dist-scripts",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@node-rs/argon2", "sharp"],
  // Some bundled CJS deps call require(); give ESM output a real one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("bundled scripts -> dist-scripts/");
