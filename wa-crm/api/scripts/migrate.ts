// Applies migrations/*.sql in name order, each in its own transaction, once.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function migrate(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from scripts/ (tsx) and dist/scripts/ (compiled).
  const dir = here.split(sep).includes('dist') ? join(here, '..', '..', 'migrations') : join(here, '..', 'migrations');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    // One migrator at a time, even if two containers start together.
    await client.query('SELECT pg_advisory_lock(727274)');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
  migrate(url).then((a) => console.log(a.length ? `done (${a.length})` : 'up to date'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
