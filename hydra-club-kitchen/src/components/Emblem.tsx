import Image from "next/image";
import emblem from "../../public/brand/hydra-emblem.png";

/**
 * The Hydra dragon emblem, cut from the client's logo by `pnpm brand:assets`.
 * Every use of the logo goes through here. When Hydra sends the SVG, swap the
 * source in scripts/brand-assets.ts and re-run it; nothing else changes.
 * Pass title="" where the emblem is decorative (next to the word "Hydra").
 */
export function Emblem({ className = "", title = "Hydra Club & Kitchen", priority = false }: { className?: string; title?: string; priority?: boolean }) {
  return <Image src={emblem} alt={title} priority={priority} sizes="(min-width: 768px) 160px, 120px" className={`object-contain ${className}`} />;
}
