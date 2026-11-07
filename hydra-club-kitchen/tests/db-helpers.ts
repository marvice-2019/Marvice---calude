import { runMigrations } from "../scripts/migrate";
import { seed } from "../scripts/seed";
import { createDb } from "../src/db/client";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://hydra:hydra@localhost:5432/hydra_test";

if (!/test/.test(new URL(TEST_DB_URL).pathname)) {
  throw new Error(`Refusing to reset a database whose name does not contain "test": ${TEST_DB_URL}`);
}

/** Drops everything, applies all committed migrations from scratch, then seeds. */
export async function freshDb() {
  const reset = createDb(TEST_DB_URL, { max: 1 });
  await reset.sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await reset.sql.end();
  await runMigrations(TEST_DB_URL);
  const conn = createDb(TEST_DB_URL, { max: 5 });
  await seed(conn.db);
  return conn;
}
