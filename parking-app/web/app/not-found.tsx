import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panelpage">
      <h1>Page not found</h1>
      <p>That page or lot doesn&apos;t exist. If you typed a lot code, check the yellow board at the entrance.</p>
      <div className="stack"><Link className="btn" href="/">Find parking</Link><Link className="btn ghost" href="/park-now">Park now with a lot code</Link></div>
    </section>
  );
}
