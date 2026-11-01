/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { hslHex, localImage, ogCard } from "@/lib/og/card";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { ERAS, ERA_BY_ID, LANE_BY_ID, REGION_MAPS, dateRows, formatDate, type TimelineEntry } from "@/lib/timeline/types";

/**
 * Preview cards for /pokedex/timeline and each entry's own page: the time
 * tunnel in the eras' colours, and for an entry its starters and box
 * legendaries, or its region's map from the PokéGuessr atlas.
 */

/** Nested frames in each era's colours, running into the distance. */
export function TunnelVisual({ year, colors = ERAS.map((e) => e.a) }: { year?: string; colors?: string[] }) {
  const rings = 7;
  const W = 470, H = 380;
  let inner: React.ReactNode = year ? (
    <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 40, color: colors[colors.length - 1], letterSpacing: 2 }}>{year}</div>
  ) : (
    <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, background: "#fff", boxShadow: "0 0 20px #fff" }} />
  );
  for (let i = rings - 1; i >= 0; i--) {
    const k = i / rings;
    const c = colors[Math.min(colors.length - 1, Math.floor((i / rings) * colors.length))];
    inner = (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: Math.round(W * (1 - k * 0.82)),
          height: Math.round(H * (1 - k * 0.82)),
          borderRadius: 26 - i * 3,
          border: `${Math.max(2, 5 - i * 0.5)}px solid ${c}`,
          boxShadow: `0 0 ${22 - i * 2}px ${c}aa, inset 0 0 ${16 - i * 2}px ${c}55`,
        }}
      >
        {inner}
      </div>
    );
  }
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: W, height: H }}>{inner}</div>;
}

/** The page's own card. */
export function timelineCard() {
  return ogCard({
    eyebrow: "Pokédex · History in 3D",
    title: ["Pokémon", ["Timeline", ERAS[0].a]],
    subtitle: "Every game, anime season, film and card-game era since 1996. Fly through it.",
    accent: ERAS[0].a,
    visual: <TunnelVisual />,
    footer: "Take the tour →",
  });
}

/** An entry's own card: what it is, when, and its Pokémon or its region. */
export async function timelineEntryCard(entry: TimelineEntry) {
  const era = ERA_BY_ID[entry.era];
  const lane = LANE_BY_ID[entry.lane];
  const first = dateRows(entry)[0];
  const year = first.date.slice(0, 4);
  const len = entry.title.length;
  const where = first.label === "Worldwide" ? "Worldwide" : first.label === "Japan" ? "Japan" : first.label;
  const subtitle = `${where}: ${formatDate(first.date)} · ${entry.platform}${entry.region ? ` · ${entry.region}` : ""}`;
  const map = entry.region ? Object.values(REGION_MAPS).find((m) => m.region === entry.region) : undefined;
  let visual: React.ReactNode;
  if (entry.legendaries.length || entry.starters.length) {
    const big = entry.legendaries[0] ?? entry.starters[0];
    const small = entry.legendaries.length ? entry.starters : entry.starters.slice(1);
    visual = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 470 }}>
        <div style={{ display: "flex", width: 300, height: 300, borderRadius: 150, alignItems: "center", justifyContent: "center", background: `radial-gradient(circle, ${era.a}44 0%, ${era.a}00 68%)` }}>
          <img src={artworkUrl(big.id)} width={280} height={280} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: -16 }}>
          {small.slice(0, 3).map((s) => (
            <img key={s.id} src={artworkUrl(s.id)} width={104} height={104} />
          ))}
        </div>
      </div>
    );
  } else if (map) {
    const src = await localImage(`public${map.src}`, 470);
    const h = Math.round((470 * map.h) / map.w);
    const fit = h > 380 ? { width: Math.round((380 * map.w) / map.h), height: 380 } : { width: 470, height: h };
    visual = (
      <div style={{ display: "flex", borderRadius: 18, overflow: "hidden", border: `3px solid ${era.a}`, boxShadow: `0 0 40px ${era.a}66` }}>
        <img src={src} width={fit.width} height={fit.height} />
      </div>
    );
  } else {
    visual = <TunnelVisual year={year} colors={ERAS.slice(0, ERAS.findIndex((e) => e.id === era.id) + 1).map((e) => e.a)} />;
  }
  return ogCard({
    eyebrow: `Timeline · ${year} · ${lane.label}`,
    title: [entry.title],
    titleSize: len > 40 ? 44 : len > 28 ? 52 : len > 18 ? 60 : 70,
    subtitle,
    accent: entry.lane === "games" ? era.a : hslHex(lane.color),
    visual,
    footer: `${era.label} · ${era.device} →`,
  });
}

