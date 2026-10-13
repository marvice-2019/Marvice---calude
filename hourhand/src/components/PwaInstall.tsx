"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "./ui/Button";

const DISMISSED = "hh-install-dismissed";

// The browser's install prompt event isn't in the DOM typings.
type InstallPrompt = Event & { prompt: () => Promise<unknown> };

const noSubscribe = () => () => {};

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

function installedAlready(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// iOS Safari never fires beforeinstallprompt; other iOS browsers can't add to the Home Screen, so no hint there.
function iosSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Registers the service worker and offers "Install app" (or, on iOS Safari, a Share-menu hint). Dismissal is remembered. */
export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [closed, setClosed] = useState(false);
  // False on the server and during hydration, so the markup matches.
  const eligible = useSyncExternalStore(noSubscribe, () => !dismissedBefore() && !installedAlready(), () => false);
  const iosHint = useSyncExternalStore(noSubscribe, iosSafariBrowser, () => false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (closed || !eligible || (!prompt && !iosHint)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
    setClosed(true);
  };
  const install = async () => {
    await prompt?.prompt();
    dismiss();
  };

  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 text-sm text-text lg:px-8">
      <span>{prompt ? "Put Hourhand on your home screen." : "Add to Home Screen from the Share menu"}</span>
      <span className="flex gap-2">
        {prompt && <Button size="sm" onClick={install}>Install app</Button>}
        <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
      </span>
    </div>
  );
}
