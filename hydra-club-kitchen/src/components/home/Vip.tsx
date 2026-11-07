import type { HomeData } from "@/lib/home-data";

// STUB from the stage 4 foundation. Owner: 4B content. Replace the body; keep the export name and props.
export function Vip({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="vip" className="px-4 py-24" data-stub="Vip">
      <h2 className="font-display text-4xl tracking-[-0.05em]">VIP</h2>
    </section>
  );
}
