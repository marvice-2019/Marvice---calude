import { ProgressVar } from "@/components/fx/ProgressVar";
import { STORY } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/** §3.4 Story: one large paragraph revealed word by word as it scrolls in. Readable in full without JS or with reduced motion. */
export function Story({ data }: { data: HomeData }) {
  void data;
  const words = STORY.split(" ");
  return (
    <section id="place" aria-labelledby="place-heading" className="scroll-mt-20 px-4 py-28 md:px-8 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <h2 id="place-heading" className="text-sm tracking-[0.2em] text-aqua uppercase">
          The place · club and kitchen in Koramangala
        </h2>
        <ProgressVar cssVar="--p" mode="pass" className="hydra-story mt-6">
          <p
            className="font-display text-[clamp(2rem,6.2vw,5.2rem)] leading-[1.02] tracking-[-0.05em]"
            style={{ "--n": words.length } as React.CSSProperties}
          >
            {words.map((w, i) => (
              <span key={i} className="hydra-word" style={{ "--i": i } as React.CSSProperties}>
                {w}{" "}
              </span>
            ))}
          </p>
        </ProgressVar>
      </div>
    </section>
  );
}
