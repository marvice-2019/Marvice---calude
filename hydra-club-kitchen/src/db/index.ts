import "server-only";
import { createDb, type Db } from "./client";

// One pool per server process (survives Next.js dev hot reloads via globalThis).
const g = globalThis as unknown as { __hydraDb?: Db };

export function getDb(): Db {
  g.__hydraDb ??= createDb(process.env.DATABASE_URL ?? "").db;
  return g.__hydraDb;
}
