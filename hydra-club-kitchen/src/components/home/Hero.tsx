import { Emblem } from "@/components/Emblem";
import { HeroStage } from "@/components/fx/HeroStage";
import { LightShow } from "@/components/fx/LightShow";
import { Photo } from "@/components/Photo";
import { HERO_SCENES, TAGLINE } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/**
 * §3.2 Hero. Scenes use the admin's hero photos when set, otherwise a branded
 * gradient with the emblem watermark. The laser show sits on top (screen blend).
 */
export function Hero({ data }: { data: HomeData }) {
  return (
    <section id="top" aria-label="Hydra Club & Kitchen" className="relative">
      <HeroStage>
        <div className="hydra-hero-stage absolute inset-0">
          {HERO_SCENES.map((s, i) => {
            const photo = data.photos.find((p) => p.heroScene === s.tag);
            return (
              <div key={s.tag} data-scene={i} className="hydra-scene absolute inset-0" aria-hidden="true">
                {photo ? (
                  <Photo photo={photo} fill sizes="100vw" priority={i === 0} className="hydra-kenburns object-cover" />
                ) : (
                  <div className={`hydra-art hydra-art-${s.tag} absolute inset-0`}>
                    <Emblem className="absolute top-1/2 left-1/2 size-[70vmin] -translate-x-1/2 -translate-y-1/2 text-white/[.04]" title="" />
                  </div>
                )}
              </div>
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-b from-bg/30 via-bg/10 to-bg/90" />
        </div>
        <LightShow id="fx" shockOnTap className="mix-blend-screen" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
          <Emblem className="hydra-hero-emblem size-20 text-aqua md:size-24" title="" />
          <h1 className="hydra-wordmark mt-4 font-display text-[clamp(4.5rem,21vw,20rem)] leading-[0.8] tracking-[-0.06em] text-text">
            Hydra
            <span className="sr-only"> Club &amp; Kitchen, nightclub and kitchen in Koramangala, Bengaluru</span>
          </h1>
          <p className="mt-5 font-display text-[clamp(1.4rem,4.5vw,2.4rem)] tracking-[-0.04em] text-text">{TAGLINE}</p>
          <p className="mt-2 max-w-md text-muted">Club and kitchen in Koramangala. Tap anywhere to light it up.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#floor" className="inline-flex min-h-12 items-center rounded-full bg-aqua px-7 font-semibold text-on-aqua">
              Book a table
            </a>
            <a href="#menu" className="inline-flex min-h-12 items-center rounded-full border border-line bg-bg/30 px-7 backdrop-blur">
              See the menu
            </a>
          </div>
        </div>
      </HeroStage>
    </section>
  );
}
