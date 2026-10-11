import { createMemoryStore } from "./memory-store";
import { createPgStore, getPool } from "./pg-store";
import type { DataStore } from "./types";

export * from "./types";

/** HOURHAND_DATA=memory (default) or postgres. Postgres needs DATABASE_URL; there is no fallback to memory. */
function createStore(): DataStore {
  const kind = process.env.HOURHAND_DATA ?? "memory";
  if (kind === "memory") return createMemoryStore();
  if (kind !== "postgres") throw new Error(`HOURHAND_DATA must be "memory" or "postgres", got "${kind}"`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("HOURHAND_DATA=postgres needs DATABASE_URL to be set");
  return createPgStore(getPool(url));
}

// Pages and route handlers can be bundled separately, each with its own copy of this module.
// Keeping the store on globalThis gives the whole server process one shared store.
const shared = globalThis as typeof globalThis & { __hourhandStore?: DataStore };

/** The one store screens use. */
export const store: DataStore = (shared.__hourhandStore ??= createStore());
