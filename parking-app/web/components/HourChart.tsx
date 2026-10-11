import { clock } from "@/lib/format";

/**
 * Cars parked per hour: one series, one hue (--bar, validated in both themes), so no legend box; the heading names it.
 * Every bar has a hover/focus tooltip, and the same numbers are in a table for screen readers and print.
 */
export function HourChart({ rows, capacity, title }: { rows: { hour: string; occupied: number; arrivals: number }[]; capacity: number; title: string }) {
  const max = Math.max(capacity, ...rows.map(r => r.occupied), 1);
  const every = Math.ceil(rows.length / 8); // ~8 axis labels whatever the range
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="label" style={{ marginBottom: 26 }}>{title}</figcaption>
      <div className="chart" style={{ "--n": rows.length } as React.CSSProperties} aria-hidden>
        <span className="grid" style={{ bottom: `calc(22px + ${(capacity / max) * (180 - 22)}px)` }}>capacity {capacity}</span>
        {rows.map((r, i) => (
          <div key={r.hour} className="col" tabIndex={-1}>
            <span className="tip">{clock(r.hour)} · {r.occupied} parked · {r.arrivals} arrived</span>
            <i style={{ height: `${(r.occupied / max) * 100}%` }} />
            {i % every === 0 && <small className={(i / every) % 2 ? "alt" : undefined}>{clock(r.hour).replace(":00", "")}</small>}
          </div>
        ))}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>Show as table</summary>
        <div className="tblwrap">
          <table className="tbl">
            <caption className="sr">{title}</caption>
            <thead><tr><th>Hour</th><th className="r">Parked</th><th className="r">Arrived</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.hour}><td>{clock(r.hour)}</td><td className="r">{r.occupied}</td><td className="r">{r.arrivals}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
