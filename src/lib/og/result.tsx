import "server-only";
import type { ShareAccent, ShareTile, ShareView } from "@/lib/share";
import { C, ogCard } from "./card";

/**
 * The preview card of a shared result (/s/<payload>, /c/<token>): the game,
 * the score and the board as coloured squares, in the site's card style.
 * Everything comes from a validated ShareView and is drawn as text.
 */

export const ACCENT_HEX: Record<ShareAccent, string> = { violet: C.violet, green: C.green, yellow: C.yellow, pink: C.pink, cyan: C.cyan };

const TILE: Record<ShareTile, { bg: string; mark?: string }> = {
  hit: { bg: C.green },
  near: { bg: C.yellow },
  far: { bg: "#fb8c3a" },
  wrong: { bg: C.red },
  miss: { bg: C.edge },
  up: { bg: C.edge, mark: "↑" },
  down: { bg: C.edge, mark: "↓" },
  mask: { bg: "#3b82f6" },
  "conn-yellow": { bg: "#f2cf55" },
  "conn-green": { bg: "#96c860" },
  "conn-blue": { bg: "#8fb2ef" },
  "conn-purple": { bg: "#bd8ad8" },
  "conn-red": { bg: "#e8776c" },
  "pdk-purple": { bg: "#a855f7" },
  "pdk-blue": { bg: "#3b82f6" },
  "pdk-green": { bg: "#22c55e" },
  "pdk-yellow": { bg: "#eab308" },
  "pdk-empty": { bg: "#27272a" },
};

/** The board, sized to fit about 470 × 380. */
export function TilesVisual({ tiles, numbers, accent }: { tiles: ShareTile[][]; numbers?: string[]; accent: string }) {
  const rows = tiles.slice(0, 10);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const gap = 10;
  const size = Math.floor(Math.min((470 - 52 - gap * (cols - 1)) / cols, (380 - 52 - (numbers ? 44 : 0) - gap * (rows.length - 1)) / Math.max(1, rows.length), 76));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap, padding: 26, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", gap }}>
          {row.map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: size,
                height: size,
                borderRadius: Math.round(size / 6),
                background: TILE[t].bg,
                alignItems: "center",
                justifyContent: "center",
                fontSize: Math.round(size * 0.55),
                color: C.text,
              }}
            >
              {TILE[t].mark ?? ""}
            </div>
          ))}
        </div>
      ))}
      {numbers && (
        <div style={{ display: "flex", gap }}>
          {numbers.slice(0, cols).map((n, i) => (
            <div key={i} style={{ display: "flex", width: size, justifyContent: "center", fontFamily: "Silkscreen", fontSize: 18, color: accent }}>
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A battle's result: no board, just the outcome on a panel. */
function OutcomeVisual({ view, accent }: { view: ShareView; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 440, padding: "30px 32px", borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted }}>{view.game}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
        {view.chips.map((c, i) => (
          <div
            key={c}
            style={{ display: "flex", padding: "12px 18px", borderRadius: 10, border: `2px solid ${i ? C.edge : accent}`, fontFamily: "Chakra Petch", fontSize: 34, color: i ? C.text : accent, textTransform: "uppercase" }}
          >
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The whole card for a result. `who` names the player only where a signed link vouches for it. */
export function resultCard(view: ShareView, who?: string) {
  const accent = ACCENT_HEX[view.accent];
  const headline = view.headline;
  return ogCard({
    eyebrow: view.label,
    title: [[headline, accent]],
    titleSize: headline.length > 12 ? 64 : headline.length > 7 ? 84 : 112,
    subtitle: who ? `${who} · ${view.detail}` : view.detail,
    accent,
    visual: view.tiles.length ? <TilesVisual tiles={view.tiles} numbers={view.numbers} accent={accent} /> : <OutcomeVisual view={view} accent={accent} />,
    footer: `Can you beat it? ${view.playLabel} →`,
  });
}
