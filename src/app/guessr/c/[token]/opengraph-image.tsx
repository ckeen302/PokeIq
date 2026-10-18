/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";
import { readGeoChallenge } from "@/lib/server/geo";

/** Preview card for PokéGuessr challenge links on Discord / X / iMessage. */

export const runtime = "nodejs";
export const alt = "PokéGuessr challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

function square(score: number): string {
  if (score >= 4000) return "#22c55e";
  if (score >= 2000) return "#eab308";
  if (score > 0) return "#f97316";
  return "#ef4444";
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  let challenge: ReturnType<typeof readGeoChallenge> = null;
  try {
    challenge = readGeoChallenge(decodeURIComponent((await params).token));
  } catch {
    challenge = null;
  }

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
          background: "linear-gradient(135deg, #08071a 0%, #0f2a2a 55%, #1c4a2e 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800 }}>
            <img src={LOGO_DATA_URI} width={96} height={96} style={{ marginRight: 24 }} />
            Poké<span style={{ color: "#22c55e" }}>Guessr</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>GeoGuessr for Pokémon · Kanto</div>
        </div>

        {challenge ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 40, color: "#cbd5e1" }}>{`${challenge.name || "A trainer"} scored`}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
              <div style={{ display: "flex", fontSize: 170, fontWeight: 900, color: "#4ade80", lineHeight: 1 }}>
                {challenge.score.toLocaleString("en-US")}
              </div>
              <div style={{ display: "flex", fontSize: 40, color: "#94a3b8", paddingBottom: 18 }}>/ 25,000</div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {challenge.rounds.map((s, i) => (
                <div key={i} style={{ width: 64, height: 64, borderRadius: 12, background: square(s) }} />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800 }}>Where in Kanto is this?</div>
        )}

        <div style={{ display: "flex", fontSize: 34, color: "#4ade80", fontWeight: 700 }}>Same five places. Can you beat it? →</div>
      </div>
    ),
    size
  );
}
