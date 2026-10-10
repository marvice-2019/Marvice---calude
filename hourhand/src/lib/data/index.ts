import { createMemoryStore } from "./memory-store";
import type { DataStore } from "./types";

export * from "./types";

/** The one store screens use. Swap this line for the Postgres implementation later; no screen changes. */
export const store: DataStore = createMemoryStore();
