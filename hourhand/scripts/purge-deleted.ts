// Permanently removes accounts closed more than 30 days ago. The job runner does this every hour; this script is for running it by hand.
// Usage: DATABASE_URL=postgres://… node scripts/purge-deleted.ts
import pg from "pg";
import { purgeClosedAccounts } from "../src/lib/data/account-lifecycle.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query("begin");
  const purged = await purgeClosedAccounts(client, new Date());
  await client.query("commit");
  console.log(`Purged ${purged} closed ${purged === 1 ? "account" : "accounts"}`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
