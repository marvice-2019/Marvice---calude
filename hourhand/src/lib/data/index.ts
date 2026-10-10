import { createMemoryStore } from "./memory-store";
import type { DataStore } from "./types";

export * from "./types";

// Pages and route handlers can be bundled separately, each with its own copy of this module.
// Keeping the in-memory store on globalThis gives the whole server process one shared store.
const shared = globalThis as typeof globalThis & { __hourhandStore?: DataStore };

/** The one store screens use. Swap this line for the Postgres implementation later; no screen changes. */
export const store: DataStore = (shared.__hourhandStore ??= createMemoryStore());
