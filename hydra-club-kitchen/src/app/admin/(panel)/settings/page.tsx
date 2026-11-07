import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { unconfirmedWarnings } from "@/admin/content";
import { requireUser } from "@/auth/guard";
import { HoursForm, SettingField, ZoneForm } from "@/components/admin/content-forms";
import { getDb } from "@/db";
import { settings, zones } from "@/db/schema";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** §8 Settings, with a visible warning list for everything still unconfirmed (§12). */
export default async function SettingsPage() {
  await requireUser("settings:write");
  const db = getDb();
  const [rows, zoneRows] = await Promise.all([db.select().from(settings), db.select().from(zones).orderBy(asc(zones.sort))]);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  const warnings = unconfirmedWarnings(s, zoneRows);
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Settings</h1>
      {warnings.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-amber/50 bg-amber/10 p-4">
          <p className="font-semibold text-amber">Still to confirm</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SettingField k="whatsapp" labelText="WhatsApp number" value={s.whatsapp} kind="text" hint="With country code. Empty hides every WhatsApp button." />
        <SettingField k="phone" labelText="Phone number" value={s.phone} kind="text" hint="With country code. Empty hides it on the site." />
        <SettingField k="instagram" labelText="Instagram link" value={s.instagram} kind="url" />
        <SettingField k="maps_url" labelText="Google Maps link" value={s.maps_url} kind="url" />
        <SettingField k="address" labelText="Address" value={s.address} kind="text" />
        <SettingField k="address_block_confirmed" labelText="Address confirmed" value={s.address_block_confirmed} kind="bool" hint="Tick once 5th vs 6th Block is checked." />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Booking</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SettingField k="booking_enabled" labelText="Online booking on" value={s.booking_enabled} kind="bool" />
        <SettingField k="captcha_enabled" labelText="Spam check (Turnstile)" value={s.captcha_enabled} kind="bool" hint="Only if fake bookings appear. Needs server setup first." />
        <SettingField k="slot_length_minutes" labelText="Table time (minutes)" value={s.slot_length_minutes} kind="number" />
        <SettingField k="booking_window_days" labelText="Book up to (days ahead)" value={s.booking_window_days} kind="number" />
        <SettingField k="max_guests_per_table" labelText="Max guests per table" value={s.max_guests_per_table} kind="number" />
      </div>
      <div className="mt-3">
        <HoursForm hours={(s.hours as Record<string, { open: string; close: string } | null> | null) ?? null} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">VIP cards and zones</h2>
      <p className="text-sm text-muted">Seats and minimum spend stay hidden on the site until you fill them in.</p>
      <div className="mt-3 grid gap-3">
        {zoneRows.map((z) => (
          <ZoneForm key={z.key} z={z} />
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">About the place</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SettingField k="cuisines" labelText="Cuisines" value={s.cuisines} kind="list" hint="Comma separated." />
        <SettingField k="good_to_know" labelText="Good to know" value={s.good_to_know} kind="list" hint="Comma separated, e.g. Valet parking, AC." />
        <SettingField k="cost_for_two_inr" labelText="About ₹ for two" value={s.cost_for_two_inr} kind="number" />
      </div>
    </>
  );
}
