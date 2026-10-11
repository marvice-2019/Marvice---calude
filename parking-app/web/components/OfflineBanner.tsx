"use client";
import { useOnline } from "./hooks";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="banner" role="status">You&apos;re offline. Passes saved on this device still open; booking needs a connection.</div>;
}
