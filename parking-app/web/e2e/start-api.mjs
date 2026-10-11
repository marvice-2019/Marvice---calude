// Starts the API for the end-to-end suite on a fresh, seeded database, with throwaway local test
// settings (never production values). Runs as a web server, which starts before any test setup,
// so the database work happens here.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, "../../api");
const pgAdmin = process.env.TEST_PG_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const DB = "bayline_e2e";
const dbUrl = pgAdmin.replace(/\/[^/]*$/, "/" + DB);

const admin = new pg.Client({ connectionString: pgAdmin });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();
execFileSync(process.execPath, [path.join(api, "dist/src/migrate.js")], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit" });
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
await db.query(readFileSync(path.join(api, "seed/dev-seed.sql"), "utf8"));
const { rows } = await db.query("SELECT count(*)::int AS n FROM lots WHERE is_live");
await db.end();
if (rows[0].n !== 8) { console.error(`seed: expected 8 live lots, got ${rows[0].n}`); process.exit(1); }

const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: "3100",
  DATABASE_URL: dbUrl,
  WEB_ORIGIN: "http://127.0.0.1:3201",
  JWT_SECRET: "e2e-only-signing-key-".padEnd(48, "x"),
  RAZORPAY_WEBHOOK_SECRET: "e2e-webhook-secret", // must match e2e/env.ts
  INTERNAL_TOKEN: "e2e-internal-token-1234",
  OTP_PROVIDER: "console",
  RATE_LIMIT_MAX: "2000"
};
delete env.RAZORPAY_KEY_ID; delete env.RAZORPAY_KEY_SECRET; // force the API's fake gateway

const child = spawn(process.execPath, [path.join(api, "dist/src/server.js")], { env, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
