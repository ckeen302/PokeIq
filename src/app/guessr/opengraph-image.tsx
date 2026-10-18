/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";

/** Share card for /guessr. */

export const alt = "PokéGuessr: GeoGuessr for Pokémon";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #08071a 0%, #0f2a2a 55%, #1c4a2e 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 48, fontWeight: 800 }}>
          <img src={LOGO_DATA_URI} width={104} height={104} style={{ marginRight: 26 }} />
          Poké<span style={{ color: "#22c55e" }}>Guessr</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 104, fontWeight: 900, lineHeight: 1 }}>Where in the world</div>
          <div style={{ display: "flex", fontSize: 104, fontWeight: 900, lineHeight: 1.05, color: "#4ade80" }}>is this?</div>
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#cbd5e1" }}>
          GeoGuessr for Pokémon · real in-game views · new daily game
        </div>
      </div>
    ),
    size
  );
}
