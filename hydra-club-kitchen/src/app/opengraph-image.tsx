import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Hydra Club & Kitchen, Koramangala. Eat first. Stay late.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card with the client's dragon emblem (public/brand, built by `pnpm brand:assets`). */
export default async function OpengraphImage() {
  const emblem = await readFile(path.join(process.cwd(), "public/brand/hydra-emblem.png"));
  const src = `data:image/png;base64,${emblem.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
          background: "radial-gradient(90% 80% at 30% 20%, #0f4a63 0%, #03070D 70%)",
          color: "#EAF2F8",
          fontFamily: "sans-serif",
        }}
      >
        <img src={src} width={300} height={305} alt="" style={{ filter: "drop-shadow(0 0 40px rgba(43,184,220,.45))" }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: "-0.06em", lineHeight: 1 }}>Hydra</div>
          <div style={{ fontSize: 34, color: "#2BB8DC", letterSpacing: "0.18em", marginTop: 8 }}>CLUB &amp; KITCHEN</div>
          <div style={{ fontSize: 44, marginTop: 30 }}>Eat first. Stay late.</div>
          <div style={{ fontSize: 26, marginTop: 10, color: "#8DA2B5" }}>Koramangala, Bengaluru</div>
        </div>
      </div>
    ),
    size,
  );
}
