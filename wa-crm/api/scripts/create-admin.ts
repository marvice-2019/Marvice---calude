// Creates a platform admin, or promotes an existing user. Usage: npm run create-admin -- email name
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashPassword } from '../src/auth.js';
import { createPool, withPlatform, type Db } from '../src/db.js';

/** New users get a generated password (returned once); existing users keep theirs. */
export async function createAdmin(db: Db, email: string, name: string) {
  const password = randomBytes(18).toString('base64url');
  const hash = await hashPassword(password);
  const r = await withPlatform(db, (tx) => tx.query<{ id: string; created: boolean }>(
    `INSERT INTO users (email, name, password_hash, is_platform_admin) VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE SET is_platform_admin = true
     RETURNING id, (xmax = 0) AS created`, [email, name, hash]));
  const row = r.rows[0]!;
  return { userId: row.id, created: row.created, password: row.created ? password : null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = z.tuple([z.string().trim().toLowerCase().email(), z.string().trim().min(2).max(120)])
    .safeParse(process.argv.slice(2, 4));
  const url = process.env.DATABASE_URL;
  if (!args.success || !url) {
    console.error('usage: DATABASE_URL=... npm run create-admin -- <email> <name>');
    process.exit(1);
  }
  const db = createPool(url);
  createAdmin(db, ...args.data)
    .then((a) => {
      if (a.password) console.log(`created platform admin ${args.data[0]}\npassword (shown once): ${a.password}`);
      else console.log(`promoted ${args.data[0]} to platform admin; their existing password is unchanged`);
    })
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => db.end());
}
