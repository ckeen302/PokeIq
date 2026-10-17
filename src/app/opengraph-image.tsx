/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

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
          background: "radial-gradient(circle at 75% 15%, #3a1a6e 0%, #08071a 60%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 120, fontWeight: 900 }}>
          <img src={LOGO_DATA_URI} width={110} height={110} style={{ marginRight: 28 }} />
          Poké<span style={{ color: "#f0457f" }}>IQ</span>
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
