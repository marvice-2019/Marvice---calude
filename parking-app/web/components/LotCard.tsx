import Link from "next/link";
import type { SearchRow } from "@/lib/types";
import { km, rupees } from "@/lib/format";

// One result: the price people compare is the total with fee and GST, never a teaser hourly rate.
export function LotCard({ row, query, i = 0 }: { row: SearchRow; query: string; i?: number }) {
  const { lot, quote, spots_left } = row;
  const low = spots_left <= 5, full = spots_left === 0 || lot.status === "full";
  const fill = Math.min(100, Math.max(6, spots_left * 4));
  return (
    <li className="rise" style={{ "--i": i } as React.CSSProperties}>
      <Link href={`/lots/${lot.id}?${query}`} className="lot card" aria-label={`${lot.name}, ${km(row.distance_m)} away, ${rupees(quote.totalPaise)} total`}>
        <span className="psign" aria-hidden>P</span>
        <div>
          <h3>{lot.name}</h3>
          <p className="meta">{km(row.distance_m)} · {lot.address} · <span className="code">{lot.code.replace(/^BLR/, "")}</span></p>
          <div className="badges">
            {lot.covered && <span className="badge">Covered</span>}
            {lot.ev_chargers > 0 && <span className="badge ev">EV charging</span>}
            {lot.valet && <span className="badge valet">Valet</span>}
            {lot.open_24h && <span className="badge">24 h</span>}
          </div>
          <p className={`avail${low ? " low" : ""}`}>{full ? "Full for these times" : low ? `Only ${spots_left} bays left` : `${spots_left} bays free`}</p>
          <span className={`meter${low ? " low" : ""}`} aria-hidden><i style={{ width: `${full ? 0 : fill}%` }} /></span>
        </div>
        <div className="price">
          <b className="num">{rupees(quote.totalPaise)}</b>
          <small>{quote.hours} h · incl. GST</small>
        </div>
      </Link>
    </li>
  );
}
