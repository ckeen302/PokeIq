/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard, visualLength } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";
import { ogNames } from "@/lib/og/names";
import { POKEDEX, artworkUrl, getPokemonBySlug, type StatKey } from "@/lib/pokemon/pokedex";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";

/**
 * Share card for each species: artwork, number, typing and base stats. Drawn
 * on first request and cached from then on (1,025 cards would slow every build).
 */

export const alt = "A Pokémon's Pokédex entry on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The stats in the card's order; their short labels are og's species.stats.<key>. */
const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const t = await ogT(props);
  const names = await ogNames(t.locale);
  const p = getPokemonBySlug((await props.params).slug) ?? POKEDEX[0];
  const accent = typeColor(p.types[0]);
  const name = names.species(p.id, p.name);
  const len = visualLength(name);
  return ogCard({
    eyebrow: t("species.eyebrow", { number: String(p.id).padStart(4, "0"), gen: p.gen }),
    title: [name],
    titleSize: len > 14 ? 50 : len > 9 ? 62 : 78,
    subtitle: t("species.subtitle", { genus: names.genus(p.genus), bst: p.bst }),
    accent,
    visual: (
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 200 }}>
          {p.types.map((type) => (
            <div
              key={type}
              style={{ display: "flex", justifyContent: "center", padding: "8px 0", borderRadius: 8, background: typeColor(type), color: typeTextColor(type), fontFamily: "Chakra Petch", fontSize: 26, textTransform: "uppercase" }}
            >
              {names.type(type)}
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {STATS.map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", fontSize: 20, color: C.muted }}>
                <span style={{ display: "flex", width: 48 }}>{t(`species.stats.${k}`)}</span>
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
    footer: t("species.footer"),
    t,
  });
}
