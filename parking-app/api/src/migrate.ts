import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

// Applies migrations/*.sql in name order, once each, inside a transaction per file.
export async function migrate(url: string, dir = defaultDir()): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await client.query("SELECT pg_advisory_lock(727001)");
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map(r => r.name as string));
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    await client.end();
  }
  return applied;
}

function defaultDir() {
  // works from src/ (tsx) and dist/src/ (compiled)
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? "../../migrations" : "../migrations");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  migrate(url).then(a => { console.log(a.length ? `Applied: ${a.join(", ")}` : "Nothing to apply"); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
