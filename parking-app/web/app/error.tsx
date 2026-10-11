"use client";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panelpage errbox" role="alert">
      <h1 style={{ color: "var(--ink)" }}>Something went wrong</h1>
      <p style={{ color: "var(--ink)" }}>Something went wrong on our side. Try again in a minute. If you were paying, check My passes before paying again.</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
      <Link className="btn ghost" href="/passes">My passes</Link>
    </section>
  );
}
