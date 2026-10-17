import { ImageResponse } from "next/og";
import { readShareCard } from "@/lib/server/share-card";
import { MODULE_INFO } from "@/lib/modes";
import { dailyNumber } from "@/lib/daily";
import { iqTitle } from "@/lib/rating";

/** Rich preview card for shared results on Discord / X / iMessage. */

export const runtime = "nodejs";
export const alt = "PokéIQ challenge result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const card = readShareCard((await params).token);
  const title = card ? (card.day ? `Daily #${dailyNumber(card.day)}` : MODULE_INFO[card.m].title) : "PokéIQ";
  const grid = (card?.gr ?? "").slice(0, 30);

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
          background: "linear-gradient(135deg, #0b1120 0%, #111a33 55%, #3b2a06 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>
            Poké<span style={{ color: "#fbbf24" }}>IQ</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>{title}</div>
        </div>

        {card ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 64 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>PokéIQ</div>
              <div style={{ display: "flex", fontSize: 180, fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>{String(card.q)}</div>
              <div style={{ display: "flex", fontSize: 32, color: "#cbd5e1" }}>{iqTitle(card.q)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 12 }}>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 800 }}>{`${card.c}/${card.t} correct`}</div>
              <div style={{ display: "flex", fontSize: 34, color: "#cbd5e1" }}>
                {(card.n || "A trainer") + " · " + card.sc.toLocaleString() + " pts"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 560 }}>
                {[...grid].map((c, i) => (
                  <div
                    key={i}
                    style={{ width: 40, height: 40, borderRadius: 8, background: c === "1" ? "#22c55e" : "#ef4444" }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800 }}>The ultimate Pokémon quiz</div>
        )}

        <div style={{ display: "flex", fontSize: 32, color: "#fbbf24", fontWeight: 700 }}>Can you beat it? →</div>
      </div>
    ),
    size
  );
}
