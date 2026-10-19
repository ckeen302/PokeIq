/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";
import { peekBattle } from "@/lib/server/battle-engine/store";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";

/** Preview card for live battle links on Discord / X / iMessage. */

export const runtime = "nodejs";
export const alt = "Pokémon battle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

/** A Poké Ball, drawn (no remote images). */
function Ball({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 64, height: 64, borderRadius: 32, overflow: "hidden", border: "5px solid #0b0a1a" }}>
      <div style={{ display: "flex", height: 27, background: color }} />
      <div style={{ display: "flex", height: 0, borderTop: "5px solid #0b0a1a" }} />
      <div style={{ display: "flex", flex: 1, background: "#f8fafc" }} />
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const found = await peekBattle((await params).code);
  const battle = found?.kind === "pvp" ? found : undefined;
  const [host, guest] = battle?.names ?? [];
  const format = battle ? PLAY_FORMAT_INFO[battle.format].name : "Pokémon battle";

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
          background: "linear-gradient(160deg, #0b0a1f 0%, #2b1450 50%, #6b1d5c 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800 }}>
            <img src={LOGO_DATA_URI} width={96} height={96} style={{ marginRight: 24 }} />
            Poké<span style={{ color: "#e2306f" }}>IQ</span>
            <span style={{ marginLeft: 18, color: "#c4b5fd" }}>Battle</span>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Ball key={i} color={i < 3 ? "#e2306f" : "#38bdf8"} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#cbd5e1" }}>{guest ? format : `${host || "A trainer"} challenges you · ${format}`}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 96, fontWeight: 900, lineHeight: 1 }}>
            <span style={{ color: "#e2306f" }}>{host || "You"}</span>
            <span style={{ fontSize: 56, color: "#94a3b8" }}>vs</span>
            <span style={{ color: "#38bdf8" }}>{guest || "?"}</span>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 34, color: "#4ade80", fontWeight: 700 }}>Real Showdown mechanics · turn timer · open the link to battle →</div>
      </div>
    ),
    size
  );
}
