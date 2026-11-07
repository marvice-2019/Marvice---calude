"use client";

import { useState } from "react";
import { useAdminAction } from "./client";

const input = "admin-input w-full";
const label = "grid gap-1 text-sm text-muted";

/** Add a walk-in for tonight: table, time ("now" or a slot), guests, name, phone optional. */
export function WalkInForm({ tables, slots }: { tables: string[]; slots: string[] }) {
  const { run, busy } = useAdminAction();
  const [f, setF] = useState({ table: tables[0] ?? "", time: "now", guests: 2, name: "", phone: "", notes: "" });
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await run("POST", "/api/admin/bookings", { ...f, phone: f.phone || undefined, notes: f.notes || undefined }, "Walk-in added.");
        if (done) setF((x) => ({ ...x, name: "", phone: "", notes: "" }));
      }}
    >
      <h2 className="text-lg font-semibold sm:col-span-2">Add a walk-in</h2>
      <label className={label}>
        Table
        <select className={input} value={f.table} onChange={(e) => setF({ ...f, table: e.target.value })}>
          {tables.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        Time
        <select className={input} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}>
          <option value="now">Now</option>
          {slots.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        Guests
        <input className={input} type="number" min={1} max={50} value={f.guests} onChange={(e) => setF({ ...f, guests: Number(e.target.value) })} />
      </label>
      <label className={label}>
        Name
        <input className={input} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className={label}>
        Mobile (optional)
        <input className={input} type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </label>
      <label className={label}>
        Notes (optional)
        <input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn sm:col-span-2">
        Add walk-in
      </button>
    </form>
  );
}

/** Block a table or a whole zone for a night; lists the bookings it clashes with so staff can call them. */
export function HoldForm({ tables, zones, defaultDate }: { tables: string[]; zones: { key: string; name: string }[]; defaultDate: string }) {
  const { run, busy } = useAdminAction();
  const [target, setTarget] = useState(`zone:${zones[0]?.key ?? ""}`);
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [clashes, setClashes] = useState<{ ref: string; table: string; time: string; name: string }[] | null>(null);
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const [kind, value] = target.split(":") as ["zone" | "table", string];
        const res = await run("POST", "/api/admin/holds", { [kind]: value, date, reason }, "Hold added.");
        if (res) {
          setClashes((res.conflicts as typeof clashes) ?? []);
          setReason("");
        }
      }}
    >
      <h2 className="text-lg font-semibold sm:col-span-3">Block a table or zone</h2>
      <label className={label}>
        What
        <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
          <optgroup label="Whole zone">
            {zones.map((z) => (
              <option key={z.key} value={`zone:${z.key}`}>
                {z.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="One table">
            {tables.map((t) => (
              <option key={t} value={`table:${t}`}>
                {t}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className={label}>
        Night
        <input className={input} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={label}>
        Reason
        <input className={input} required maxLength={200} placeholder="Private party" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn sm:col-span-3">
        Block it
      </button>
      {clashes && clashes.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber/50 bg-amber/10 p-3 text-sm sm:col-span-3">
          <p className="font-semibold">These guests are already booked there. Call them:</p>
          <ul className="mt-1">
            {clashes.map((c) => (
              <li key={c.ref}>
                {c.time} · {c.table} · {c.name} · {c.ref}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

export function DeleteButton({ url, label, confirmText, okText }: { url: string; label: string; confirmText: string; okText: string }) {
  const { run, busy } = useAdminAction();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => window.confirm(confirmText) && void run("DELETE", url, undefined, okText)}
      className="min-h-11 rounded-lg border border-line px-3 text-sm text-[#ffb4b4] disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** Owner: add a staff account with a temporary password (they must change it at first sign-in). */
export function NewUserForm() {
  const { run, busy } = useAdminAction();
  const [f, setF] = useState({ name: "", email: "", role: "host", tempPassword: "" });
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("POST", "/api/admin/users", f, "Account created. Share the temporary password in person.")) setF({ name: "", email: "", role: "host", tempPassword: "" });
      }}
    >
      <h2 className="text-lg font-semibold sm:col-span-2">Add staff</h2>
      <label className={label}>
        Name
        <input className={input} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className={label}>
        Email
        <input className={input} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label className={label}>
        Role
        <select className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="host">Host: bookings at the door</option>
          <option value="manager">Manager: plus holds, content, settings, export</option>
          <option value="owner">Owner: everything, plus staff</option>
        </select>
      </label>
      <label className={label}>
        Temporary password (12+ characters)
        <input className={input} required minLength={12} autoComplete="new-password" value={f.tempPassword} onChange={(e) => setF({ ...f, tempPassword: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn sm:col-span-2">
        Create account
      </button>
    </form>
  );
}

/** Owner: change one person's role or reset their password. */
export function UserControls({ id, role, isSelf }: { id: string; role: string; isSelf: boolean }) {
  const { run, busy } = useAdminAction();
  if (isSelf) return <p className="text-xs text-muted">This is you.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${id}`}>
        Role
      </label>
      <select
        id={`role-${id}`}
        className="admin-input"
        defaultValue={role}
        disabled={busy}
        onChange={(e) => void run("PATCH", "/api/admin/users", { id, role: e.target.value }, "Role updated.")}
      >
        <option value="host">Host</option>
        <option value="manager">Manager</option>
        <option value="owner">Owner</option>
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const temp = window.prompt("New temporary password (12+ characters). They'll be asked to change it.");
          if (temp) void run("PATCH", "/api/admin/users", { id, tempPassword: temp }, "Password reset. Their old sessions are signed out.");
        }}
        className="min-h-11 rounded-lg border border-line px-3 text-sm"
      >
        Reset password
      </button>
      <DeleteButton url={`/api/admin/users?id=${id}`} label="Remove" confirmText="Remove this account? They lose access at once." okText="Account removed." />
    </div>
  );
}
