import { GalleryClient } from "@/components/content/GalleryClient";
import { blurDataUrl } from "@/components/Photo";
import type { HomeData } from "@/lib/home-data";

const HOME_LIMIT = 12;

/** §3.9 Gallery. Photos come from admin; with none yet it shows a branded placeholder, never stock images. */
export async function Gallery({ data, full = false }: { data: HomeData; full?: boolean }) {
  const source = full ? data.photos : data.photos.slice(0, HOME_LIMIT);
  const photos = await Promise.all(
    source.map(async (p) => ({
      id: p.id,
      tag: p.tag,
      alt: p.alt,
      src: p.webpUrl,
      width: p.width,
      height: p.height,
      blur: await blurDataUrl(p.blurhash, p.width, p.height),
    })),
  );
  const Heading = full ? "h1" : "h2";
  return (
    <section id="gallery" aria-labelledby="gallery-heading" className="scroll-mt-20 px-4 py-24 md:px-8 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm tracking-[0.2em] text-aqua uppercase">Gallery</p>
        <Heading id="gallery-heading" className="mt-2 font-display text-[clamp(2.4rem,7vw,5rem)] leading-[0.95] tracking-[-0.05em]">
          Inside the nightclub in Koramangala
        </Heading>
        <div className="mt-8">
          {photos.length > 0 ? (
            <>
              <GalleryClient photos={photos} bookHref={full ? "/book" : "#floor"} />
              {!full && data.photos.length > HOME_LIMIT && (
                <a href="/gallery" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-line px-5">
                  See all {data.photos.length} photos
                </a>
              )}
            </>
          ) : (
            <div className="grid auto-rows-[140px] grid-cols-2 gap-3 md:auto-rows-[200px] md:grid-cols-4">
              {(["club", "kitchen", "bar", "floor"] as const).map((tag, i) => (
                <div key={tag} className={`hydra-art hydra-art-${tag} relative overflow-hidden rounded-2xl border border-line ${i === 0 ? "col-span-2 row-span-2" : ""}`}>
                  <span className="absolute bottom-3 left-4 font-display text-2xl capitalize tracking-[-0.04em] text-text/80">{tag}</span>
                </div>
              ))}
              <p className="col-span-2 self-center text-muted md:col-span-3">
                New photos from the floor are on the way.{" "}
                {data.settings.instagram && (
                  <a href={data.settings.instagram} target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-4">
                    See the latest on Instagram
                  </a>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
