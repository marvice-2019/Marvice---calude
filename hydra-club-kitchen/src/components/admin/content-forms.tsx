"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAdminAction, useAdminToast } from "./client";

const input = "admin-input w-full";
const label = "grid gap-1 text-sm text-muted";
const TAGS = ["club", "kitchen", "bar", "floor"] as const;

// ---------- Photos ----------
export function PhotoUploader() {
  const toast = useAdminToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({ tag: "club", alt: "", heroScene: "" });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast({ kind: "error", text: "Choose a photo first." });
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("tag", meta.tag);
    fd.set("alt", meta.alt);
    if (meta.heroScene) fd.set("heroScene", meta.heroScene);
    try {
      const res = await fetch("/api/admin/photos", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return toast({ kind: "error", text: data.message ?? "Upload failed." });
      toast({ kind: "ok", text: "Photo added. It's live on the site." });
      setFile(null);
      setMeta((m) => ({ ...m, alt: "", heroScene: "" }));
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      toast({ kind: "error", text: "No connection. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
      <h2 className="text-lg font-semibold sm:col-span-2">Add a photo</h2>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) setFile(f);
        }}
        className={`grid min-h-28 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-4 text-center text-sm sm:col-span-2 ${drag ? "border-aqua bg-aqua/10" : "border-line"}`}
      >
        <span>{file ? `${file.name} · ${(file.size / 1_048_576).toFixed(1)} MB` : "Drop a photo here, or tap to choose (JPG, PNG, WebP, AVIF · up to 15 MB)"}</span>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className={label}>
        Where
        <select className={input} value={meta.tag} onChange={(e) => setMeta({ ...meta, tag: e.target.value })}>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Use as hero for
        <select className={input} value={meta.heroScene} onChange={(e) => setMeta({ ...meta, heroScene: e.target.value })}>
          <option value="">Not a hero photo</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t[0]!.toUpperCase() + t.slice(1)} scene
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        Describe it (for people who can&apos;t see it)
        <input className={input} required minLength={3} maxLength={200} placeholder="DJ on the decks, lasers over a full dance floor" value={meta.alt} onChange={(e) => setMeta({ ...meta, alt: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn sm:col-span-2">
        {busy ? "Processing…" : "Upload"}
      </button>
    </form>
  );
}

export function PhotoCard({ p }: { p: { id: number; tag: string; alt: string; heroScene: string | null; webpUrl: string; width: number; height: number; sort: number } }) {
  const { run, busy } = useAdminAction();
  const [alt, setAlt] = useState(p.alt);
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="relative aspect-[4/3]">
        <Image src={p.webpUrl} alt={p.alt} fill sizes="(min-width: 768px) 30vw, 100vw" className="object-cover" />
        {p.heroScene && <span className="absolute top-2 left-2 rounded-full bg-aqua px-2 py-0.5 text-xs font-semibold text-on-aqua">Hero · {p.heroScene}</span>}
      </div>
      <div className="grid gap-2 p-3">
        <label className={label}>
          Description
          <input className={input} value={alt} onChange={(e) => setAlt(e.target.value)} onBlur={() => alt !== p.alt && void run("PATCH", "/api/admin/photos", { id: p.id, alt }, "Description saved.")} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Where
            <select className={input} defaultValue={p.tag} disabled={busy} onChange={(e) => void run("PATCH", "/api/admin/photos", { id: p.id, tag: e.target.value }, "Moved.")}>
              {TAGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Hero
            <select
              className={input}
              defaultValue={p.heroScene ?? ""}
              disabled={busy}
              onChange={(e) => void run("PATCH", "/api/admin/photos", { id: p.id, heroScene: e.target.value || null }, "Hero updated.")}
            >
              <option value="">No</option>
              {TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void run("PATCH", "/api/admin/photos", { id: p.id, sort: Math.max(0, p.sort - 1_000_000) }, "Moved earlier.")} className="min-h-11 flex-1 rounded-lg border border-line text-sm">
            Show earlier
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm("Delete this photo from the site?") && void run("DELETE", `/api/admin/photos?id=${p.id}`, undefined, "Photo deleted.")}
            className="min-h-11 flex-1 rounded-lg border border-line text-sm text-[#ffb4b4]"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------- Menu ----------
export function CategoryForm() {
  const { run, busy } = useAdminAction();
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("POST", "/api/admin/content/menu", { kind: "category", name }, "Section added.")) setName("");
      }}
    >
      <label className="sr-only" htmlFor="new-cat">
        New section name
      </label>
      <input id="new-cat" className={input} required placeholder="New section, e.g. Small plates" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={busy} className="admin-btn shrink-0">
        Add section
      </button>
    </form>
  );
}

export function ItemForm({ categoryId }: { categoryId: number }) {
  const { run, busy } = useAdminAction();
  const empty = { name: "", description: "", priceRupees: "", veg: true };
  const [f, setF] = useState(empty);
  return (
    <form
      className="grid gap-2 rounded-lg border border-dashed border-line p-3 sm:grid-cols-[2fr_3fr_1fr_auto_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("POST", "/api/admin/content/menu", { kind: "item", categoryId, ...f }, "Dish added.")) setF(empty);
      }}
    >
      <input className={input} aria-label="Dish name" required placeholder="Dish" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className={input} aria-label="Description" placeholder="Short description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <input className={input} aria-label="Price in rupees" inputMode="decimal" placeholder="₹ price" value={f.priceRupees} onChange={(e) => setF({ ...f, priceRupees: e.target.value })} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={f.veg} onChange={(e) => setF({ ...f, veg: e.target.checked })} className="size-5" /> Veg
      </label>
      <button type="submit" disabled={busy} className="admin-btn">
        Add dish
      </button>
    </form>
  );
}

export function ItemRow({ item }: { item: { id: number; name: string; description: string | null; pricePaise: number | null; veg: boolean; available: boolean } }) {
  const { run, busy } = useAdminAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
      <p className={item.available ? "" : "text-muted line-through"}>
        <span className={`mr-2 inline-block size-3 rounded-sm border-2 align-middle ${item.veg ? "border-[#3fbf6f]" : "border-[#d9534f]"}`} aria-label={item.veg ? "Veg" : "Non-veg"} />
        {item.name}
        {item.pricePaise !== null && <span className="ml-2 text-muted">₹{(item.pricePaise / 100).toLocaleString("en-IN")}</span>}
        {item.description && <span className="block text-sm text-muted">{item.description}</span>}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void run("PATCH", "/api/admin/content/menu", { kind: "item", id: item.id, available: !item.available }, item.available ? "Marked sold out." : "Back on the menu.")} className="min-h-11 rounded-lg border border-line px-3 text-sm">
          {item.available ? "Sold out" : "Available"}
        </button>
        <button type="button" disabled={busy} onClick={() => window.confirm(`Delete ${item.name}?`) && void run("DELETE", `/api/admin/content/menu?kind=item&id=${item.id}`, undefined, "Dish deleted.")} className="min-h-11 rounded-lg border border-line px-3 text-sm text-[#ffb4b4]">
          Delete
        </button>
      </div>
    </li>
  );
}

// ---------- Nights ----------
export function NightForm() {
  const { run, busy } = useAdminAction();
  const empty = { title: "", days: "", blurb: "", accent: "aqua", ctaDateRule: "" };
  const [f, setF] = useState(empty);
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("POST", "/api/admin/content/nights", f, "Night added. It's live on the site.")) setF(empty);
      }}
    >
      <h2 className="text-lg font-semibold sm:col-span-2">Add a night</h2>
      <label className={label}>
        Title
        <input className={input} required maxLength={60} placeholder="Techno Fridays" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label className={label}>
        When (as guests read it)
        <input className={input} required maxLength={60} placeholder="Every Friday" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        One line about it
        <input className={input} required maxLength={240} value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} />
      </label>
      <label className={label}>
        Colour
        <select className={input} value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value })}>
          <option value="aqua">Aqua</option>
          <option value="amber">Amber</option>
          <option value="rose">Rose</option>
        </select>
      </label>
      <label className={label}>
        Booking button picks the next (1 Mon … 7 Sun)
        <input className={input} placeholder="5 for Fridays, 5,6 for Fri+Sat" value={f.ctaDateRule} onChange={(e) => setF({ ...f, ctaDateRule: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn sm:col-span-2">
        Add night
      </button>
    </form>
  );
}

// ---------- Settings ----------
type FieldKind = "text" | "number" | "bool" | "list" | "url";
export function SettingField({ k, labelText, value, kind, hint }: { k: string; labelText: string; value: unknown; kind: FieldKind; hint?: string }) {
  const { run, busy } = useAdminAction();
  const initial = kind === "list" ? ((value as string[]) ?? []).join(", ") : kind === "bool" ? Boolean(value) : (value ?? "") as string | number;
  const [v, setV] = useState<string | number | boolean>(initial);
  const save = () => {
    const out = kind === "list" ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : kind === "number" ? (v === "" ? null : Number(v)) : v;
    void run("PATCH", "/api/admin/content/settings", { key: k, value: out }, `${labelText} saved.`);
  };
  if (kind === "bool")
    return (
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3">
        <span>
          {labelText}
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
        <input
          type="checkbox"
          className="size-6"
          checked={Boolean(v)}
          disabled={busy}
          onChange={(e) => {
            setV(e.target.checked);
            void run("PATCH", "/api/admin/content/settings", { key: k, value: e.target.checked }, `${labelText}: ${e.target.checked ? "on" : "off"}.`);
          }}
        />
      </label>
    );
  return (
    <form
      className={label}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {labelText}
      <div className="flex gap-2">
        <input className={input} type={kind === "number" ? "number" : kind === "url" ? "url" : "text"} value={String(v)} onChange={(e) => setV(e.target.value)} />
        <button type="submit" disabled={busy} className="admin-btn shrink-0">
          Save
        </button>
      </div>
      {hint && <span className="text-xs">{hint}</span>}
    </form>
  );
}

export function HoursForm({ hours }: { hours: Record<string, { open: string; close: string } | null> | null }) {
  const { run, busy } = useAdminAction();
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const [h, setH] = useState(() => Object.fromEntries(days.map((d) => [d, hours?.[d] ?? null])) as Record<(typeof days)[number], { open: string; close: string } | null>);
  return (
    <form
      className="grid gap-2 rounded-xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("PATCH", "/api/admin/content/settings", { key: "hours", value: h }, "Hours saved. Booking slots follow them.");
      }}
    >
      <h2 className="text-lg font-semibold">Opening hours</h2>
      <p className="text-xs text-muted">A closing time after midnight (e.g. 01:00) belongs to the same night.</p>
      {days.map((d) => (
        <div key={d} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2">
          <span className="capitalize">{d}</span>
          <input aria-label={`${d} opens`} className={input} type="time" disabled={!h[d]} value={h[d]?.open ?? ""} onChange={(e) => setH({ ...h, [d]: { open: e.target.value, close: h[d]?.close ?? "01:00" } })} />
          <input aria-label={`${d} closes`} className={input} type="time" disabled={!h[d]} value={h[d]?.close ?? ""} onChange={(e) => setH({ ...h, [d]: { open: h[d]?.open ?? "11:30", close: e.target.value } })} />
          <label className="flex min-h-11 items-center gap-1 text-sm">
            <input type="checkbox" className="size-5" checked={!h[d]} onChange={(e) => setH({ ...h, [d]: e.target.checked ? null : { open: "11:30", close: "01:00" } })} /> Closed
          </label>
        </div>
      ))}
      <button type="submit" disabled={busy} className="admin-btn mt-2">
        Save hours
      </button>
    </form>
  );
}

export function ZoneForm({ z }: { z: { key: string; name: string; note: string | null; seats: number | null; minSpendPaise: number | null } }) {
  const { run, busy } = useAdminAction();
  const [f, setF] = useState({ note: z.note ?? "", seats: z.seats?.toString() ?? "", minSpendRupees: z.minSpendPaise === null ? "" : String(z.minSpendPaise / 100) });
  return (
    <form
      className="grid gap-2 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void run("PATCH", "/api/admin/content/zones", { key: z.key, ...f }, `${z.name} saved.`);
      }}
    >
      <label className={label}>
        {z.name}: line on the VIP card
        <input className={input} maxLength={240} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <label className={label}>
        Seats
        <input className={input} inputMode="numeric" placeholder="unknown" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} />
      </label>
      <label className={label}>
        Minimum spend ₹
        <input className={input} inputMode="numeric" placeholder="unknown" value={f.minSpendRupees} onChange={(e) => setF({ ...f, minSpendRupees: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="admin-btn">
        Save
      </button>
    </form>
  );
}
