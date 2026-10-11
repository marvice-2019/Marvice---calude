import { Search } from "@/components/Search";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="trails" aria-hidden><i /><i /><i /><i /></div>
        <div className="wrap">
          <p className="eyebrow rise">Bengaluru · {new Date().getFullYear()}</p>
          <h1 className="rise" style={{ "--i": 1 } as React.CSSProperties}>Your bay is <em>waiting.</em></h1>
          <p className="lede rise" style={{ "--i": 2 } as React.CSSProperties}>Book before you leave, see the full price with GST, and drive straight in. No circling, no cash, no surprise at the gate.</p>
        </div>
      </section>
      <Search />
    </>
  );
}
