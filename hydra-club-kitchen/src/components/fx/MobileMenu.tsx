"use client";

import { useEffect, useRef, useState } from "react";
import { Emblem } from "@/components/Emblem";
import { NAV } from "@/content/site";

/**
 * Full-screen menu for phones. Without JS the trigger is a #site-menu link and
 * the sheet opens with :target. With JS it traps focus, closes on Esc, and
 * returns focus to the trigger.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current!;
    const trigger = triggerRef.current;
    const focusables = () => [...sheet.querySelectorAll<HTMLElement>("a[href],button")];
    focusables()[0]?.focus();
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      const first = list[0];
      const last = list.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <a
        ref={triggerRef}
        href="#site-menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line px-4 text-sm lg:hidden"
      >
        Menu
      </a>
      <div
        id="site-menu"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        data-open={open}
        className="fixed inset-0 z-[60] hidden flex-col bg-bg/95 px-6 pt-5 pb-10 backdrop-blur-xl target:flex data-[open=true]:flex lg:hidden"
      >
        <div className="flex items-center justify-between">
          <Emblem className="size-9 text-aqua" />
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm"
          >
            Close
          </a>
        </div>
        <nav aria-label="Site" className="mt-10 flex flex-1 flex-col gap-1">
          {NAV.map((n, i) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              data-nav={n.id}
              onClick={() => setOpen(false)}
              style={{ "--i": i } as React.CSSProperties}
              className="hydra-stagger font-display text-[clamp(2rem,10vw,3rem)] leading-[1.15] tracking-[-0.05em] aria-[current]:text-aqua"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <a
          href="#floor"
          onClick={() => setOpen(false)}
          className="flex min-h-12 items-center justify-center rounded-xl bg-aqua text-lg font-semibold text-on-aqua"
        >
          Pick your table
        </a>
      </div>
    </>
  );
}
