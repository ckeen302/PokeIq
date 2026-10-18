/* eslint-disable jsx-a11y/alt-text -- Satori renders plain <img> */
import { ImageResponse } from "next/og";
import { LOGO_SVG } from "@/lib/brand/logo-svg";
import { geoRegions } from "@/lib/server/geo";
import { peekDuel } from "@/lib/server/duel-store";
import { DUEL_HP } from "@/lib/duel-types";
import { WORLD_REGION } from "@/lib/geo-types";

/** Preview card for PokéGuessr duel links on Discord / X / iMessage. */

export const runtime = "nodejs";
export const alt = "PokéGuessr duel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const duel = await peekDuel((await params).code);
  const map = duel ? geoRegions().find((r) => r.id === duel.region) : undefined;
  const mapName = !map || map.id === WORLD_REGION ? "World" : map.name;
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
            Poké<span style={{ color: "#22c55e" }}>Guessr</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>{`Duel · ${mapName}`}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#cbd5e1" }}>{guest ? "Head to head" : `${host || "A trainer"} challenges you`}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 96, fontWeight: 900, lineHeight: 1 }}>
            <span style={{ color: "#e2306f" }}>{host || "You"}</span>
            <span style={{ fontSize: 56, color: "#94a3b8" }}>vs</span>
            <span style={{ color: "#38bdf8" }}>{guest || "?"}</span>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 34, color: "#4ade80", fontWeight: 700 }}>
          {`Same places · ${DUEL_HP.toLocaleString("en-US")} HP each · closer pin wins →`}
        </div>
      </div>
    ),
    size
  );
}
