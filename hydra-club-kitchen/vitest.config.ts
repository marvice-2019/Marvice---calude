import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // Unit/integration tests only; browser specs live in tests/e2e/*.spec.ts and run with `pnpm e2e`.
    include: ["tests/**/*.test.ts"],
    // DB tests share one database and reset it, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
