import { ImageResponse } from "next/og";

export const alt = "Hydra Club & Kitchen, Koramangala. Eat first. Stay late.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card, generated from the brand mark (placeholder emblem until the client's logo file arrives). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(80% 70% at 50% 0%, #0f4a63 0%, #03070D 70%)",
          color: "#EAF2F8",
          fontFamily: "sans-serif",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="29" fill="none" stroke="#2BB8DC" strokeWidth="3" />
          <path d="M21 17v30M43 17v30M21 32h22" stroke="#2BB8DC" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>
        <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: "-0.06em", marginTop: 10 }}>Hydra</div>
        <div style={{ fontSize: 44, marginTop: 6 }}>Eat first. Stay late.</div>
        <div style={{ fontSize: 28, marginTop: 18, color: "#8DA2B5" }}>Club &amp; Kitchen · Koramangala, Bengaluru</div>
      </div>
    ),
    size,
  );
}
