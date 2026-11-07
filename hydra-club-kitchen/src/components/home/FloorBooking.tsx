import type { HomeData } from "@/lib/home-data";

// STUB from the stage 4 foundation. Owner: 4C booking. Replace the body; keep the export name and props.
export function FloorBooking({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="floor" className="px-4 py-24" data-stub="FloorBooking">
      <h2 className="font-display text-4xl tracking-[-0.05em]">Floor plan</h2>
    </section>
  );
}
