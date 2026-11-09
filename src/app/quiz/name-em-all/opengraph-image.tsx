import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { POKEDEX } from "@/lib/pokemon/pokedex";

/**
 * Share card for Name 'em All (the hub, its daily and every category): the
 * recall board as it looks mid-run, Kanto's first slots, some named and
 * some still blank.
 */

export const alt = "Name 'em All: how many Pokémon can you name from memory?";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const NAMED = new Set([1, 2, 4, 5, 7, 9, 10, 12, 16, 19, 20]);

export default function Image() {
  const slots = POKEDEX.slice(0, 20);
  return ogCard({
    eyebrow: "Name 'em All · recall quiz",
    title: ["Can you name", ["every Pokémon?", C.green]],
    titleSize: 64,
    subtitle: "Type every Pokémon you can remember before the clock runs out. A new category every day.",
    accent: C.green,
    visual: (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 20, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Silkscreen", fontSize: 20, color: C.muted }}>
          <span>{NAMED.size} / 151</span>
          <span style={{ color: C.green }}>11:42</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, width: 432 }}>
          {slots.map((p) => {
            const named = NAMED.has(p.id);
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  width: 80,
                  height: 52,
                  padding: "0 8px",
                  borderRadius: 8,
                  background: named ? `${C.green}26` : C.bg,
                  border: `2px solid ${named ? C.green : C.edge}`,
                }}
              >
                <span style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 12, color: C.muted }}>{String(p.id).padStart(4, "0")}</span>
                <span style={{ display: "flex", fontSize: 14, color: named ? C.text : C.muted }}>{named ? (p.name.length > 9 ? `${p.name.slice(0, 8)}…` : p.name) : "?"}</span>
              </div>
            );
          })}
        </div>
      </div>
    ),
    footer: "Name them all · beat the clock →",
  });
}
