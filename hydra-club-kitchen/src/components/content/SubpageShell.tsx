import Link from "next/link";
import { Emblem } from "@/components/Emblem";
import { Footer } from "@/components/home/Footer";

/** Chrome for /menu, /gallery, /privacy and /terms: logo home, a booking link, the footer. */
export function SubpageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-xl tracking-[-0.05em]">
            <Emblem className="size-9" title="" />
            Hydra
          </Link>
          <Link href="/book" className="inline-flex min-h-11 items-center rounded-full bg-aqua px-5 text-sm font-semibold text-on-aqua">
            Book a table
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <Footer />
    </>
  );
}

/** Prose layout for the legal pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <SubpageShell>
      <article className="mx-auto max-w-3xl px-4 py-16 md:px-8 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-[-0.04em] [&_li]:mt-1 [&_p]:mt-4 [&_p]:text-text/85 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:text-text/85 [&_a]:underline [&_a]:underline-offset-4">
        <h1 className="font-display text-[clamp(2.4rem,7vw,4rem)] leading-none tracking-[-0.05em]">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
        {children}
      </article>
    </SubpageShell>
  );
}
