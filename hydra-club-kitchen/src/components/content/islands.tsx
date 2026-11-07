"use client";
import { useEffect, useRef, useState } from "react";
import { emit } from "@/lib/site-events";
import { track } from "@/lib/track";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function toFloor() {
  document.getElementById("floor")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

/** Counts up once when scrolled into view; the final value is server-rendered for no-JS and reduced motion. */
export function CountUp({ value, prefix = "" }: { value: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1200);
        setShown(Math.round(value * (1 - (1 - p) ** 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      setShown(0);
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} aria-hidden="true">
      {prefix}
      {shown.toLocaleString("en-IN")}
    </span>
  );
}

export function PickZone({ zone, children, className }: { zone: "vip" | "vvip" | "mezz"; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        emit("hydra:pick-zone", { zone });
        toFloor();
      }}
    >
      {children}
    </button>
  );
}

export function PickDate({ date, className, children }: { date: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        emit("hydra:pick-date", { date });
        toFloor();
      }}
    >
      {children}
    </button>
  );
}

/** Fires menu_view once when the menu is first seen. */
export function MenuSeen() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        track("menu_view");
        io.disconnect();
      }
    });
    if (ref.current?.parentElement) io.observe(ref.current.parentElement);
    return () => io.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}

export function WhatsAppLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click")}>
      {children}
    </a>
  );
}

/** Click-to-load map: no request to Google until the visitor asks. */
export function MapEmbed({ address }: { address: string }) {
  const [on, setOn] = useState(false);
  if (on)
    return (
      <iframe
        title={`Map: ${address}`}
        src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
        className="aspect-[4/3] w-full rounded-2xl border border-line"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  return (
    <div className="hy-map-ph grid aspect-[4/3] w-full place-items-center rounded-2xl border border-line">
      <button
        type="button"
        onClick={() => setOn(true)}
        className="min-h-11 rounded-full border border-aqua px-5 text-sm font-semibold text-aqua hover:bg-aqua hover:text-on-aqua"
      >
        Show map
      </button>
      <p className="sr-only">Loads Google Maps.</p>
    </div>
  );
}
