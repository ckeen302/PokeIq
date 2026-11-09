/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { C, ogCard } from "./card";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { typeColor } from "@/lib/pokemon/type-colors";
import { ALL, formatValue, getMetric, leaderSentence, parseScope, ranking, rankingHeading, type Metric, type Ranked, type Scope } from "@/lib/dex/rankings";

/**
 * The preview card of a Pokémon rankings list (/pokedex/rankings/<list>[/<variant>]):
 * the list's name, its leader in a sentence and the top three on a podium,
 * all from the same ranking the page shows. The rankings hub gets the
 * leaders of three lists instead.
 */

const HEIGHTS = [164, 136, 116];
const ORDER = [1, 0, 2];

function Podium({ m, top, accent }: { m: Metric; top: Ranked[]; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, width: 470 }}>
      {ORDER.filter((i) => top[i]).map((i) => {
        const r = top[i];
        return (
          <div key={r.entry.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 148 }}>
            <img src={artworkUrl(r.entry.art)} width={i === 0 ? 148 : 124} height={i === 0 ? 148 : 124} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-start",
                width: 148,
                height: HEIGHTS[i],
                marginTop: 6,
                paddingTop: 8,
                borderRadius: "12px 12px 0 0",
                background: C.panel,
                border: `3px solid ${i === 0 ? accent : C.edge}`,
              }}
            >
              <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: i === 0 ? 44 : 34, color: i === 0 ? accent : C.text }}>{r.rank}</div>
              <div style={{ display: "flex", fontSize: 20, color: C.text, maxWidth: 136, textAlign: "center" }}>{r.entry.name.length > 14 ? `${r.entry.name.slice(0, 13)}…` : r.entry.name}</div>
              <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 16, color: C.muted, marginTop: 4 }}>{formatValue(m.key, r.value).main}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One list's card; `segment` is the variant ("fire", "gen-1", "all-forms") or none. */
export function rankingCard(metric: string, segment: string | null) {
  const m = getMetric(metric);
  const s: Scope | null = segment ? parseScope(segment) : ALL;
  if (!m || !s) return rankingsHubCard();
  const r = ranking(m, s);
  const accent = s.kind === "type" ? typeColor(s.type) : C.cyan;
  const heading = rankingHeading(m, s);
  return ogCard({
    eyebrow: "Pokédex · rankings",
    title: [[heading, accent]],
    titleSize: heading.length > 40 ? 40 : heading.length > 26 ? 48 : 60,
    subtitle: leaderSentence(m, s, r),
    accent,
    visual: <Podium m={m} top={r.slice(0, 3)} accent={accent} />,
    footer: "Every Pokémon, ranked →",
  });
}

const HUB: [string, string][] = [
  ["strongest", "Strongest"],
  ["fastest", "Fastest"],
  ["heaviest", "Heaviest"],
];

export function rankingsHubCard() {
  return ogCard({
    eyebrow: "Pokédex · rankings",
    title: ["Pokémon", ["rankings", C.cyan]],
    subtitle: "The heaviest, tallest, fastest and strongest Pokémon, with lists per type and generation.",
    accent: C.cyan,
    visual: (
      <div style={{ display: "flex", gap: 12 }}>
        {HUB.map(([slug, label]) => {
          const m = getMetric(slug)!;
          const top = ranking(m, ALL)[0];
          return (
            <div key={slug} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 148, padding: "14px 0", borderRadius: 14, background: C.panel, border: `3px solid ${C.edge}` }}>
              <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 16, color: C.cyan, textTransform: "uppercase" }}>{label}</div>
              <img src={artworkUrl(top.entry.art)} width={120} height={120} />
              <div style={{ display: "flex", fontSize: 18, color: C.text }}>{top.entry.name}</div>
              <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 15, color: C.muted, marginTop: 2 }}>{formatValue(m.key, top.value).main}</div>
            </div>
          );
        })}
      </div>
    ),
    footer: "Every Pokémon, ranked →",
  });
}
