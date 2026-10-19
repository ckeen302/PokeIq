/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";
import { pvpStore } from "@/lib/server/duel-store";

/** Preview card for Pokédle duel links on Discord / X / iMessage. */

export const runtime = "nodejs";
export const alt = "Pokédle duel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;
/** One row of clues, as a spoiler-free teaser. */
const TEASER = ["#22c55e", "#eab308", "#334155", "#22c55e", "#334155", "#334155", "#22c55e"];

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const found = await pvpStore.peek((await params).code);
  const duel = found?.kind === "pokedle" ? found : undefined;
  const [host, guest] = duel?.players.map((p) => p.name) ?? [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(135deg, #08071a 0%, #2a0f24 55%, #0f2a3a 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800 }}>
            <img src={LOGO_DATA_URI} width={96} height={96} style={{ marginRight: 24 }} />
            Poké<span style={{ color: "#e2306f" }}>dle</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {TEASER.map((color, i) => (
              <div key={i} style={{ width: 44, height: 44, borderRadius: 8, background: color }} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#cbd5e1" }}>{guest ? "Pokédle duel" : `${host || "A trainer"} challenges you`}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 96, fontWeight: 900, lineHeight: 1 }}>
            <span style={{ color: "#e2306f" }}>{host || "You"}</span>
            <span style={{ fontSize: 56, color: "#94a3b8" }}>vs</span>
            <span style={{ color: "#38bdf8" }}>{guest || "?"}</span>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 34, color: "#4ade80", fontWeight: 700 }}>
          Same mystery Pokémon · three rounds · most points wins →
        </div>
      </div>
    ),
    size
  );
}
