import Link from "next/link";
import { focusRing } from "./ui/focus";

const linkClass = `rounded-sm underline-offset-4 hover:text-text hover:underline ${focusRing}`;

/** Links to the privacy policy and terms, for the footers of public pages. */
export function LegalLinks({ className, labels = { nav: "Legal", privacy: "Privacy", terms: "Terms" } }: { className?: string; labels?: { nav: string; privacy: string; terms: string } }) {
  return (
    <nav aria-label={labels.nav} className={["flex flex-wrap items-center gap-4 text-sm text-text-muted", className].filter(Boolean).join(" ")}>
      <Link href="/privacy" className={linkClass}>
        {labels.privacy}
      </Link>
      <Link href="/terms" className={linkClass}>
        {labels.terms}
      </Link>
    </nav>
  );
}
