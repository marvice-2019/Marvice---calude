// Permanently removes accounts closed more than 30 days ago. Run nightly (round B3 moves this into the job queue).
// Usage: DATABASE_URL=postgres://… node scripts/purge-deleted.ts
import pg from "pg";
import { createPgStore } from "../src/lib/data/pg-store.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const purged = await createPgStore(pool).purgeDeletedAccounts(new Date());
  console.log(`Purged ${purged} closed ${purged === 1 ? "account" : "accounts"}`);
} finally {
  await pool.end();
}
