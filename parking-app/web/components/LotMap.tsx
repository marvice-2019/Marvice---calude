import type { SearchRow } from "@/lib/contract";
import { inr } from "@/lib/format";

// Schematic map: each pin at its true position relative to the search point (equirectangular
// projection, accurate to a few metres within 3 km), with 1, 2 and 3 km rings. Roads and labels
// are left out on purpose. Real map tiles wait on SPEC open question #7 (MapTiler vs Google).
const W = 400, H = 300, R = 3000; // R metres from centre to the top and bottom edges (less padding)

export function LotMap({ center, label, rows, hrefFor }: {
  center: { lat: number; lng: number }; label: string; rows: SearchRow[]; hrefFor: (r: SearchRow) => string;
}) {
  const scale = (H / 2 - 18) / R; // px per metre
  const mPerDegLat = 111_320, mPerDegLng = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const at = (lat: number, lng: number) => ({
    x: W / 2 + (lng - center.lng) * mPerDegLng * scale,
    y: H / 2 - (lat - center.lat) * mPerDegLat * scale
  });
  return (
    <div className="mapwrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Schematic map of ${rows.length} lots within 3 km of ${label}. The list has the same lots.`}>
        <rect className="bg" width={W} height={H} />
        {[1000, 2000, 3000].map(m => (
          <g key={m}>
            <circle cx={W / 2} cy={H / 2} r={m * scale} className="rd" strokeWidth={2} />
            <text className="lbl" x={W / 2 + 4} y={H / 2 - m * scale - 3}>{m / 1000} km</text>
          </g>
        ))}
        <text className="lbl" x={W - 14} y={16} textAnchor="end">N ↑</text>
        <circle className="me" cx={W / 2} cy={H / 2} r={6} />
        <text className="lbl" x={W / 2 + 9} y={H / 2 + 16}>{label}</text>
        {rows.map(r => {
          const p = at(r.lot.lat, r.lot.lng), t = inr(r.quote.ratePaise), w = t.length * 6.4 + 10;
          return (
            <a key={r.lot.id} href={hrefFor(r)} aria-label={`${r.lot.name}, ${t} per hour`}>
              <g className="pin">
                <rect x={p.x - w / 2} y={p.y - 17} width={w} height={15} rx={3} />
                <text x={p.x} y={p.y - 6.5} textAnchor="middle">{t}</text>
                <path d={`M${p.x - 3} ${p.y - 2.5} L${p.x} ${p.y + 1} L${p.x + 3} ${p.y - 2.5}`} style={{ stroke: "var(--sign)", fill: "var(--sign)" }} />
              </g>
            </a>
          );
        })}
      </svg>
      <div className="mapcap"><span>Schematic map: positions to scale, no roads shown</span><span>Tap a price to open the lot</span></div>
    </div>
  );
}
