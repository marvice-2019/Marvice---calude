import pg from "pg";
import { migrate } from "../src/migrate.js";

// Needs a Postgres 16 + PostGIS server. TEST_PG_URL points at its admin database.
const ADMIN_URL = process.env.TEST_PG_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const TEMPLATE = "bayline_test_tpl";

/** Builds a migrated template database once; each test file copies it (see helpers.ts). */
export async function setup() {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${TEMPLATE}`);
  await c.end();
  const applied = await migrate(ADMIN_URL.replace(/\/[^/]*$/, `/${TEMPLATE}`));
  if (applied.length < 2) throw new Error(`expected 2 migrations, applied: ${applied.join(", ")}`);
}
