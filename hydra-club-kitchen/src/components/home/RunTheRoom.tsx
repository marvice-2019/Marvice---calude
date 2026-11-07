import type { HomeData } from "@/lib/home-data";

// STUB from the stage 4 foundation. Owner: 4A motion. Replace the body; keep the export name and props.
export function RunTheRoom({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="run-the-room" className="px-4 py-24" data-stub="RunTheRoom">
      <h2 className="font-display text-4xl tracking-[-0.05em]">Run the room</h2>
    </section>
  );
}
