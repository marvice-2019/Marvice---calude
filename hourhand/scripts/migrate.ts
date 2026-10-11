// Applies db/migrations/NNNN_name.sql in order, each in its own transaction, recording each in schema_migrations.
// Re-running applies nothing. Usage: DATABASE_URL=... npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

/** Returns the versions it applied, in order. */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await client.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version));
    const files = (await readdir(DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const applied: string[] = [];
    for (const file of files) {
      const version = file.slice(0, -".sql".length);
      if (done.has(version)) continue;
      const sql = await readFile(DIR + file, "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [version]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(version);
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const applied = await migrate(url);
  console.log(applied.length ? `Applied ${applied.join(", ")}` : "Nothing to apply");
}
