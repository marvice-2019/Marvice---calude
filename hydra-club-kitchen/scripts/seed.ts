import { sql as dsql } from "drizzle-orm";
import { ensureOwner } from "../src/auth/core";
import { createDb, type Db } from "../src/db/client";
import { nights, settings, tables, zones } from "../src/db/schema";
import { NIGHTS, SETTINGS, TABLES, ZONES } from "../src/db/seed-data";

/**
 * Idempotent: every insert is ON CONFLICT DO NOTHING, so re-running the seed
 * never overwrites what staff changed in admin.
 */
export async function seed(db: Db) {
  await db.transaction(async (tx) => {
    await tx.insert(zones).values([...ZONES]).onConflictDoNothing({ target: zones.key });

    const zoneRows = await tx.select({ id: zones.id, key: zones.key }).from(zones);
    const zoneId = new Map(zoneRows.map((z) => [z.key, z.id]));
    await tx
      .insert(tables)
      .values(TABLES.map((t) => ({ code: t.code, zoneId: zoneId.get(t.zone)!, svgRef: t.code })))
      .onConflictDoNothing({ target: tables.code });

    await tx
      .insert(settings)
      .values(
        Object.entries(SETTINGS).map(([key, value]) => ({
          key,
          // A JS null would become SQL NULL; unconfirmed settings are stored as JSON null.
          value: value === null ? dsql`'null'::jsonb` : (value as object),
        })),
      )
      .onConflictDoNothing({ target: settings.key });

    // Nights have no natural key; only seed into an empty table.
    const [{ n }] = (await tx.execute(dsql`select count(*)::int as n from nights`)) as unknown as [{ n: number }];
    if (n === 0 && NIGHTS.length > 0) {
      await tx.insert(nights).values(NIGHTS.map((night, i) => ({ ...night, sort: i })));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, sql } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
  seed(db)
    .then(() => console.log(`seeded ${ZONES.length} zones, ${TABLES.length} tables, ${Object.keys(SETTINGS).length} settings, ${NIGHTS.length} nights`))
    .then(() => ensureOwner(db, { ADMIN_SEED_EMAIL: process.env.ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD: process.env.ADMIN_SEED_PASSWORD }))
    .then((owner) => console.log(`owner account: ${owner}`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
