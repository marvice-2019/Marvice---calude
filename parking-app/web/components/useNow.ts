"use client";
import { useEffect, useState } from "react";

/** Wall-clock milliseconds, refreshed every `every` ms. 0 until mounted, so server and client render the same. */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0), id = setInterval(tick, every);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [every]);
  return now;
}
