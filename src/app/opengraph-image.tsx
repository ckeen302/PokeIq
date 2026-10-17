import { ImageResponse } from "next/og";

export const alt = "PokéIQ — the ultimate Pokémon quiz";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          background: "radial-gradient(circle at 70% 20%, #3b2a06 0%, #0b1120 55%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 120, fontWeight: 900 }}>
          Poké<span style={{ color: "#fbbf24" }}>IQ</span>
        </div>
        <div style={{ display: "flex", fontSize: 44, color: "#cbd5e1" }}>What&apos;s your Pokémon IQ?</div>
        <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>
          Daily challenge · Who&apos;s That Pokémon · Cries · Pokédle · Type matchups
        </div>
      </div>
    ),
    size
  );
}
