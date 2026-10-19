/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { POKEDEX, artworkUrl, getPokemonBySlug, type StatKey } from "@/lib/pokemon/pokedex";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";

/**
 * Share card for each species: artwork, number, typing and base stats. Drawn
 * on first request and cached from then on (1,025 cards would slow every build).
 */

export const alt = "A Pokémon's Pokédex entry on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const STATS: [StatKey, string][] = [
  ["hp", "HP"],
  ["atk", "Atk"],
  ["def", "Def"],
  ["spa", "SpA"],
  ["spd", "SpD"],
  ["spe", "Spe"],
];

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const p = getPokemonBySlug((await params).slug) ?? POKEDEX[0];
  const accent = typeColor(p.types[0]);
  return ogCard({
    eyebrow: `Pokédex #${String(p.id).padStart(4, "0")} · Gen ${p.gen}`,
    title: [p.name],
    titleSize: p.name.length > 14 ? 50 : p.name.length > 9 ? 62 : 78,
    subtitle: `The ${p.genus}. Base stat total ${p.bst}.`,
    accent,
    visual: (
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 200 }}>
          {p.types.map((t) => (
            <div
              key={t}
              style={{ display: "flex", justifyContent: "center", padding: "8px 0", borderRadius: 8, background: typeColor(t), color: typeTextColor(t), fontFamily: "Chakra Petch", fontSize: 26, textTransform: "uppercase" }}
            >
              {t}
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {STATS.map(([k, label]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", fontSize: 20, color: C.muted }}>
                <span style={{ display: "flex", width: 48 }}>{label}</span>
                <span style={{ display: "flex", width: 46, color: C.text }}>{p.stats[k]}</span>
                <div style={{ display: "flex", width: 104, height: 8, borderRadius: 4, background: C.edge }}>
                  <div style={{ display: "flex", width: Math.round(Math.min(1, p.stats[k] / 180) * 104), height: 8, borderRadius: 4, background: accent }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <img src={artworkUrl(p.id)} width={290} height={290} />
      </div>
    ),
    footer: "Stats · evolutions · moves · matchups →",
  });
}
