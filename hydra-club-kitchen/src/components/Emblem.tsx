/**
 * PLACEHOLDER mark until the client's dragon emblem arrives (Hydra_logo.png now,
 * SVG requested). Every use of the logo goes through this component, so the swap
 * happens here only: drop the PNG in public/brand/ and render it instead.
 */
export function Emblem({ className, title = "Hydra Club & Kitchen" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M21 17v30M43 17v30M21 32h22" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
