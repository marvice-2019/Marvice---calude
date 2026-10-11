import Link from "next/link";
import { focusRing } from "./ui/focus";

const linkClass = `rounded-sm underline-offset-4 hover:text-text hover:underline ${focusRing}`;

/** Links to the privacy policy and terms, for the footers of public pages. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={["flex flex-wrap items-center gap-4 text-sm text-text-muted", className].filter(Boolean).join(" ")}>
      <Link href="/privacy" className={linkClass}>
        Privacy
      </Link>
      <Link href="/terms" className={linkClass}>
        Terms
      </Link>
    </nav>
  );
}
