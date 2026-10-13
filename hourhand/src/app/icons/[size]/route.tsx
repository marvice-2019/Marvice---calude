import { ImageResponse } from "next/og";

// App icons for the manifest and the iOS home screen, drawn like src/app/icon.svg. Colours are --hh-accent, --hh-bg and the sync-light amber.
// "any" icons are a circle on transparent; "maskable" and the 180px Apple icon fill the whole square (the OS crops them) with the clock inside the safe zone.
const ICONS: Record<string, { px: number; maskable: boolean }> = {
  "192": { px: 192, maskable: false },
  "512": { px: 512, maskable: false },
  "maskable-512": { px: 512, maskable: true },
  "180": { px: 180, maskable: true },
};

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const icon = ICONS[(await params).size];
  if (!icon) return new Response("Not found", { status: 404 });
  const { px, maskable } = icon;
  const hand = maskable ? 14 : 18; // hand length in a 64-unit box, pointing at 1 o'clock (30 degrees)
  const tip = [32 + hand * 0.5, 32 - hand * 0.866];
  return new ImageResponse(
    (
      <svg width={px} height={px} viewBox="0 0 64 64">
        {maskable ? <rect width="64" height="64" fill="#b4410e" /> : <circle cx="32" cy="32" r="31" fill="#b4410e" />}
        <line x1="32" y1="32" x2={tip[0]} y2={tip[1]} stroke="#fffdf8" strokeWidth={maskable ? 4 : 5} strokeLinecap="round" />
        <circle cx="32" cy="32" r={maskable ? 3.5 : 4} fill="#f2a93b" />
      </svg>
    ),
    { width: px, height: px },
  );
}
