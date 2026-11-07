import { sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";

/**
 * Daily data retention, as promised on /privacy:
 * - bookings are deleted 12 months after the night they were for;
 * - rate-limit entries (which hold IP addresses) are deleted after a day.
 * Run daily (Coolify scheduled task: `pnpm retention`). Idempotent.
 */
export async function runRetention(db: Db, now = new Date()) {
  const bookings = await db.execute(
    sql`delete from bookings where service_date < (${now.toISOString()}::timestamptz at time zone 'Asia/Kolkata')::date - interval '12 months' returning id`,
  );
  const hits = await db.execute(sql`delete from rate_limit_hits where at < ${now.toISOString()}::timestamptz - interval '1 day' returning id`);
  return { bookingsDeleted: bookings.length, rateLimitRowsDeleted: hits.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, sql: conn } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
  runRetention(db)
    .then((r) => console.log(`retention: ${r.bookingsDeleted} bookings, ${r.rateLimitRowsDeleted} rate-limit rows deleted`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => conn.end());
}
