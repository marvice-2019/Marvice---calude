import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap">
      <div className="empty card" style={{ marginTop: 40 }}>
        <h3>Wrong turn</h3>
        <p>This page or lot isn&apos;t on the map. It may have closed or the link is old.</p>
        <Link className="btn" href="/">Find parking</Link>
      </div>
    </div>
  );
}
