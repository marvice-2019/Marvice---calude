"use client";

import { useEffect, useRef } from "react";
import { NAV } from "@/content/site";

/** Scroll-progress hairline and the active-section underline for the server-rendered header. */
export function HeaderEnhancer() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        barRef.current?.style.setProperty("transform", `scaleX(${p.toFixed(4)})`);
        document.querySelector("[data-site-header]")?.toggleAttribute("data-scrolled", window.scrollY > 24);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const links = new Map<string, HTMLAnchorElement[]>();
    document.querySelectorAll<HTMLAnchorElement>("a[data-nav]").forEach((a) => {
      const id = a.dataset.nav!;
      links.set(id, [...(links.get(id) ?? []), a]);
    });
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, r] of visible)
          if (r > bestRatio) {
            best = id;
            bestRatio = r;
          }
        links.forEach((as, id) => as.forEach((a) => (id === best ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current"))));
      },
      { threshold: [0, 0.2, 0.4, 0.6], rootMargin: "-20% 0px -40% 0px" },
    );
    for (const { id } of NAV) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return <div ref={barRef} className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-aqua" aria-hidden="true" />;
}
