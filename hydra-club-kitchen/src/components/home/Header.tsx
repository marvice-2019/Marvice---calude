import { Emblem } from "@/components/Emblem";
import { GlobalFx } from "@/components/fx/GlobalFx";
import { HeaderEnhancer } from "@/components/fx/HeaderEnhancer";
import { MobileMenu } from "@/components/fx/MobileMenu";
import { SoundButton } from "@/components/fx/SoundButton";
import { NAV } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/** §3.1 Glass header. Links work without JS; islands add progress, underline, sound and the phone menu. */
export function Header({ data }: { data: HomeData }) {
  void data;
  return (
    <>
      <a href="#floor" className="sr-only z-[70] rounded bg-aqua px-4 py-2 text-on-aqua focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to booking
      </a>
      <header
        data-site-header
        className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-colors data-[scrolled]:border-line data-[scrolled]:bg-bg/60 data-[scrolled]:backdrop-blur-xl"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 md:px-8">
          <a href="#top" className="flex min-h-11 items-center gap-2 font-display text-xl tracking-[-0.05em]">
            <Emblem className="size-8 text-aqua drop-shadow-[0_0_10px_rgba(43,184,220,.6)]" />
            Hydra
          </a>
          <nav aria-label="Site" className="ml-6 hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                data-nav={n.id}
                className="relative inline-flex min-h-11 items-center px-3 text-sm text-muted transition-colors after:absolute after:inset-x-3 after:bottom-2 after:h-px after:origin-left after:scale-x-0 after:bg-aqua after:transition-transform hover:text-text aria-[current]:text-text aria-[current]:after:scale-x-100"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SoundButton />
            <a
              href="#floor"
              className="hidden min-h-11 items-center rounded-full bg-aqua px-5 text-sm font-semibold text-on-aqua sm:inline-flex"
            >
              Book a table
            </a>
            <MobileMenu />
          </div>
        </div>
        <HeaderEnhancer />
      </header>
      <GlobalFx />
    </>
  );
}
