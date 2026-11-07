import type { HomeData } from "@/lib/home-data";

// STUB from the stage 4 foundation. Owner: 4A motion. Replace the body; keep the export name and props.
export function Marquee({ data }: { data: HomeData }) {
  void data;
  return (
    <div className="px-4 py-24" data-stub="Marquee">
      <h2 className="font-display text-4xl tracking-[-0.05em]">Marquee</h2>
    </div>
  );
}
