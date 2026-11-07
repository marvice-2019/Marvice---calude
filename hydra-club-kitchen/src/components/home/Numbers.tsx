import type { HomeData } from "@/lib/home-data";

// STUB from the stage 4 foundation. Owner: 4B content. Replace the body; keep the export name and props.
export function Numbers({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="numbers" className="px-4 py-24" data-stub="Numbers">
      <h2 className="font-display text-4xl tracking-[-0.05em]">Numbers</h2>
    </section>
  );
}
