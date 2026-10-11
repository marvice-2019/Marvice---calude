import Link from "next/link";
import type { SyncStatus } from "@/lib/data";
import { focusRing } from "./ui/focus";

const tone: Record<SyncStatus, string> = {
  ok: "bg-success-bg text-success",
  degraded: "bg-warning-bg text-warning",
  disconnected: "bg-danger-bg text-danger",
};

/** Calendar sync health as a dot plus words, so it never relies on colour alone. */
export function SyncLight({ status, minutesAgo }: { status: SyncStatus; minutesAgo?: number | null }) {
  const words =
    status === "ok"
      ? `In sync · checked ${minutesAgo ?? 0} min ago`
      : status === "degraded"
        ? "Sync slow · retrying"
        : "Disconnected. Bookings paused";
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs ${tone[status]}`}>
        <span aria-hidden className="size-2 rounded-pill bg-current" />
        {words}
      </span>
      {status === "disconnected" && (
        <Link href="/dashboard/calendars" className={`inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-semibold text-accent underline ${focusRing}`}>
          Reconnect
        </Link>
      )}
    </div>
  );
}
