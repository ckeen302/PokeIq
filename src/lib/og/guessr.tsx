/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { C, localImage, ogCard } from "./card";
import type { GeoShareView } from "@/lib/server/geo-share";

/**
 * The preview card of a shared PokéGuessr result (/guessr/r/<token>): the
 * map that was played with a square per round (or per place named in a
 * streak) in GeoGuessr's colours, the total, and for a duel both trainers
 * with their HP. Never a place's name.
 */

const tile = (score: number) => (score >= 4000 ? C.green : score >= 2000 ? C.yellow : score > 0 ? "#fb8c3a" : C.red);
const fmt = (n: number) => n.toLocaleString("en-US");

/** The played map with the round squares along its foot. */
async function MapVisual({ view }: { view: GeoShareView }) {
  const map = await localImage(`public${view.map.src}`, 470);
  const streak = view.kind === "streak" || view.kind === "region-streak";
  const squares = streak ? view.rounds.map((s) => (s > 0 ? C.green : C.red)).slice(-12) : view.rounds.map(tile);
  const size = Math.max(22, Math.min(54, Math.floor((470 - 40 - 8 * (squares.length - 1)) / Math.max(1, squares.length))));
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 470, borderRadius: 18, border: `3px solid ${C.edge}`, overflow: "hidden", background: C.panel, boxShadow: "0 30px 60px rgba(0,0,0,0.55)" }}>
      <div style={{ display: "flex", position: "relative", width: 464, height: 290, overflow: "hidden" }}>
        <img src={map} width={464} height={290} style={{ objectFit: "cover" }} />
        <div style={{ display: "flex", position: "absolute", left: 12, top: 12, padding: "6px 12px", borderRadius: 8, background: "rgba(0,0,0,0.65)", fontFamily: "Silkscreen", fontSize: 18, color: "#fff" }}>
          {view.map.name}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "14px 20px", alignItems: "center" }}>
        {squares.map((bg, i) => (
          <div key={i} style={{ display: "flex", width: size, height: size, borderRadius: Math.round(size / 5), background: bg, alignItems: "center", justifyContent: "center", fontFamily: "Silkscreen", fontSize: Math.round(size * 0.4), color: "#08071a" }}>
            {!streak && size >= 40 ? String(i + 1) : ""}
          </div>
        ))}
        {streak && view.rounds.length > 12 && <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 18, color: C.muted }}>…</div>}
      </div>
    </div>
  );
}

/** A duel: both trainers, their HP bars and round scores. */
function DuelVisual({ view }: { view: GeoShareView }) {
  const players = view.players ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 470, padding: 24, gap: 18, borderRadius: 18, border: `3px solid ${C.edge}`, background: "linear-gradient(180deg, #2c1a5c 0%, #1a1238 55%, #0e0b22 100%)" }}>
      {players.map((p, seat) => {
        const hp = Math.max(0, Math.min(1, p.hp / 6000));
        return (
          <div key={seat} style={{ display: "flex", flexDirection: "column", padding: "12px 16px", borderRadius: 12, background: "rgba(0,0,0,0.45)", border: `2px solid ${p.winner ? C.green : "rgba(255,255,255,0.2)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "Chakra Petch", fontSize: 30, color: p.winner ? C.green : "#fff", textTransform: "uppercase" }}>{p.name}</span>
              <span style={{ fontFamily: "Silkscreen", fontSize: 18, color: "rgba(255,255,255,0.75)" }}>{fmt(p.hp)} HP</span>
            </div>
            <div style={{ display: "flex", height: 12, marginTop: 8, borderRadius: 4, background: "rgba(0,0,0,0.6)", overflow: "hidden" }}>
              <div style={{ display: "flex", width: `${hp * 100}%`, height: "100%", background: hp > 0.5 ? C.green : hp > 0.22 ? C.yellow : C.red }} />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {p.scores.slice(0, 12).map((s, i) => (
                <div key={i} style={{ display: "flex", width: 26, height: 26, borderRadius: 6, background: tile(s) }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export async function guessrResultCard(view: GeoShareView) {
  const accent = view.kind === "duel" ? C.violet : C.green;
  return ogCard({
    eyebrow: view.eyebrow,
    title: [[view.headline, accent]],
    titleSize: view.headline.length > 14 ? 56 : view.headline.length > 9 ? 72 : 96,
    subtitle: view.detail,
    accent,
    visual: view.kind === "duel" ? <DuelVisual view={view} /> : await MapVisual({ view }),
    footer: `Can you beat it? ${view.playLabel} →`,
  });
}
