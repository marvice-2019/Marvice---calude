import { LightShow } from "@/components/fx/LightShow";
import { RoomControls } from "@/components/fx/RoomControls";
import { RUN_THE_ROOM } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/** §3.5 Run the room: the interactive light show. Pointer aims the beams; colour modes; Drop. */
export function RunTheRoom({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="run-the-room" aria-labelledby="room-heading" className="relative isolate min-h-[100svh] overflow-hidden bg-black">
      <LightShow id="fx2" interactive />
      <div className="pointer-events-none relative z-10 flex min-h-[100svh] flex-col items-center justify-between px-4 py-20 text-center">
        <div>
          <h2 id="room-heading" className="font-display text-[clamp(2.6rem,9vw,7rem)] leading-[0.9] tracking-[-0.05em]">
            {RUN_THE_ROOM.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-text/85">{RUN_THE_ROOM.body}</p>
        </div>
        <div className="pointer-events-auto">
          <RoomControls dropLabel={RUN_THE_ROOM.dropLabel} />
        </div>
      </div>
    </section>
  );
}
