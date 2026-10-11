import { ImageResponse } from "next/og";

// The share card shown when an hourhand.cloud link is pasted into WhatsApp, LinkedIn or X.
// Colours are the light-theme values of --hh-bg, --hh-text, --hh-text-muted and --hh-accent (an image can't read CSS variables).
export const alt = "Hourhand: your booking link, kept in sync";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#fffdf8", color: "#1f1a14" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 44, fontWeight: 700, color: "#b4410e" }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#b4410e", display: "flex" }} />
          Hourhand
        </div>
        <div style={{ marginTop: 48, fontSize: 76, fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>Your booking link, kept in sync.</div>
        <div style={{ marginTop: 28, fontSize: 36, color: "#62584b", maxWidth: 960 }}>Clients book only the times you are really free. hourhand.cloud</div>
      </div>
    ),
    size,
  );
}
