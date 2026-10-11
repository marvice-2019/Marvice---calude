"use server";

import { revalidatePath } from "next/cache";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { disconnectConnection, setAddToCalendar, setCheckConflicts } from "@/lib/calendar/connections";
import { calendarDeps } from "@/lib/calendar/env";
import { getPool } from "@/lib/data/pg-store";
import { kickJobs } from "@/lib/jobs/kick";

// Each action checks the session itself and changes only the signed-in host's own rows (enforced in the SQL).

const pool = () => getPool(process.env.DATABASE_URL as string);

export async function toggleConflictCheck(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) return;
  const changed = await setCheckConflicts(pool(), user.id, String(form.get("calendarId")), form.get("on") === "1");
  if (changed) {
    // Sync again now, so the slot engine sees the change within seconds.
    await pool().query("update calendar_connections set next_sync_at = now() where id = (select connection_id from calendars where id = $1 and user_id = $2)",
      [String(form.get("calendarId")), user.id]);
    kickJobs();
  }
  revalidatePath("/dashboard/calendars");
}

export async function useForBookings(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) return;
  await setAddToCalendar(pool(), user.id, String(form.get("calendarId")));
  revalidatePath("/dashboard/calendars");
}

export async function disconnectCalendar(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) return;
  const deps = calendarDeps();
  await disconnectConnection(pool(), deps?.google ?? null, deps?.key ?? null, user.id, String(form.get("connectionId")));
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard", "layout");
}
