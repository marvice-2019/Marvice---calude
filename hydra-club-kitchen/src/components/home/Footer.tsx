import Link from "next/link";
import { Emblem } from "@/components/Emblem";
import { BUILT_BY } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

export function Footer({ data }: { data?: HomeData }) {
  void data;
  return (
    <footer className="border-t border-line px-4 py-12 text-sm text-muted md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="inline-flex min-h-11 items-center gap-3 text-text">
          <Emblem className="size-9" />
          <span>© {new Date().getFullYear()} Hydra Club & Kitchen</span>
        </Link>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6">
          <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-text">Privacy</Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-text">Terms</Link>
          <span className="inline-flex min-h-11 items-center">{BUILT_BY.label}</span>
        </nav>
      </div>
    </footer>
  );
}
