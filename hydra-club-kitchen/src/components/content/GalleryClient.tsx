"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useScrollProgress } from "@/components/fx/useScrollProgress";

export type GalleryPhoto = { id: number; tag: "club" | "kitchen" | "bar" | "floor"; alt: string; src: string; width: number; height: number; blur?: string };
const TABS = [
  { key: "all", label: "All" },
  { key: "club", label: "Club" },
  { key: "kitchen", label: "Kitchen" },
  { key: "bar", label: "Bar" },
  { key: "floor", label: "Floor" },
] as const;

/** §3.9 Gallery: filter tabs, cursor tilt with glare, scroll drift, and a lightbox. */
export function GalleryClient({ photos, bookHref }: { photos: GalleryPhoto[]; bookHref: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [open, setOpen] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<number, HTMLButtonElement>());
  const shown = useMemo(() => (tab === "all" ? photos : photos.filter((p) => p.tag === tab)), [photos, tab]);
  const [motionOk, setMotionOk] = useState(false);

  useScrollProgress(gridRef, "--gp", "pass");
  useEffect(() => {
    setMotionOk(window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  function tilt(e: React.PointerEvent<HTMLButtonElement>) {
    if (!motionOk) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${((0.5 - y) * 10).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
  }
  function untilt(e: React.PointerEvent<HTMLButtonElement>) {
    for (const v of ["--rx", "--ry"]) e.currentTarget.style.setProperty(v, "0deg");
  }

  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Filter photos">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="min-h-11 shrink-0 rounded-full border border-line px-5 text-sm aria-pressed:border-text aria-pressed:bg-surface2"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div ref={gridRef} className="mt-6 grid auto-rows-[150px] grid-flow-dense grid-cols-2 gap-3 md:auto-rows-[210px] md:grid-cols-4">
        {shown.map((p, i) => {
          const wide = p.width / p.height > 1.35;
          const tall = p.height / p.width > 1.2;
          return (
            <button
              key={p.id}
              type="button"
              ref={(el) => {
                if (el) tileRefs.current.set(p.id, el);
                else tileRefs.current.delete(p.id);
              }}
              onClick={() => setOpen(i)}
              onPointerMove={tilt}
              onPointerLeave={untilt}
              aria-label={`Open photo: ${p.alt}`}
              style={{ "--d": (i % 3) - 1 } as React.CSSProperties}
              className={`hydra-tile group relative overflow-hidden rounded-2xl border border-line bg-surface ${wide ? "col-span-2" : ""} ${tall ? "row-span-2" : ""}`}
            >
              <Image
                src={p.src}
                alt=""
                fill
                sizes="(min-width: 768px) 25vw, 50vw"
                placeholder={p.blur ? "blur" : "empty"}
                blurDataURL={p.blur}
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <span className="hydra-glare" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {open !== null && shown[open] && (
        <Lightbox
          photos={shown}
          index={open}
          bookHref={bookHref}
          onIndex={setOpen}
          onClose={() => {
            const id = shown[open]?.id;
            setOpen(null);
            if (id !== undefined) requestAnimationFrame(() => tileRefs.current.get(id)?.focus());
          }}
        />
      )}
    </div>
  );
}

function Lightbox({
  photos,
  index,
  bookHref,
  onIndex,
  onClose,
}: {
  photos: GalleryPhoto[];
  index: number;
  bookHref: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const p = photos[index]!;
  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);

  useEffect(() => {
    const dialog = ref.current!;
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Tab") {
        const list = [...dialog.querySelectorAll<HTMLElement>("a[href],button")];
        const first = list[0];
        const last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}: ${p.alt}`}
      className="fixed inset-0 z-[90] flex flex-col bg-bg/95 backdrop-blur-xl"
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted" aria-live="polite">
          {index + 1} / {photos.length}
        </p>
        <button type="button" data-autofocus onClick={onClose} className="min-h-11 rounded-full border border-line px-5">
          Close
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Image src={p.src} alt={p.alt} fill sizes="100vw" className="object-contain" />
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="size-12 rounded-full border border-line text-xl">
          ←
        </button>
        <a href={bookHref} onClick={onClose} className="inline-flex min-h-12 items-center rounded-full bg-aqua px-6 font-semibold text-on-aqua">
          Book a table
        </a>
        <button type="button" onClick={() => go(1)} aria-label="Next photo" className="size-12 rounded-full border border-line text-xl">
          →
        </button>
      </div>
    </div>
  );
}
