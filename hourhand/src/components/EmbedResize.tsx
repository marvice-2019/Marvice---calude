"use client";

import { useEffect } from "react";

/** When a guest page is framed by /embed.js on a host's site, tell it the page's height so the frame fits. */
export function EmbedResize() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ hourhand: "height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
