import Link from "next/link";
import type { SearchRow } from "@/lib/contract";
import { inr, KIND_LABEL, km } from "@/lib/format";

/** Server-rendered lot list for public pages. Links go to the crawlable lot page. */
export function LotList({ rows, emptyText }: { rows: SearchRow[] | null; emptyText: string }) {
  if (rows === null) return <div className="errbox" role="alert">Live prices are unavailable right now. Try again in a minute.</div>;
  if (rows.length === 0) return <div className="empty">{emptyText}</div>;
  return (
    <div className="list">
      {rows.map(r => (
        <Link key={r.lot.id} className="lot" href={`/parking/bengaluru/lot/${r.lot.code}`}>
          <span className="p-sign" aria-hidden="true">P</span>
          <span style={{ minWidth: 0 }}>
            <h2>{r.lot.name}</h2>
            <div className="meta"><span className="lotcode">{r.lot.code}</span> {km(r.distance_m)} · {KIND_LABEL[r.lot.kind] ?? r.lot.kind}</div>
            <div className="chips">
              {r.lot.covered && <span className="chip">Covered</span>}
              {r.lot.ev_chargers > 0 && <span className="chip ev">EV charging</span>}
              {r.lot.open_24h && <span className="chip">Open 24 hours</span>}
            </div>
          </span>
          <span className="price"><b className="num">{inr(r.quote.ratePaise)}</b><span>per hour + GST</span></span>
        </Link>
      ))}
    </div>
  );
}
