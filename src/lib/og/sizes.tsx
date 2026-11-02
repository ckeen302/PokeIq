/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ogCard } from "@/lib/og/card";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { SIZE_ITEMS } from "@/lib/sizes/data";
import { presetLineup, type SizePreset } from "@/lib/sizes/presets";
import { dims, formatFeet, formatMetres, measureOf, type SizeItem } from "@/lib/sizes/types";

/**
 * Preview cards for /pokedex/sizes: the figures stand on a ground line at
 * their true relative sizes (a Pokémon beside an adult human, a preset as a
 * lineup growing from its smallest to its largest, a comparison side by
 * side), so the card itself makes the size point.
 */

const ACCENT = "#ffd84a";
const W = 470, H = 360;

/** One figure: its HOME render cropped to the visible box, `h` px tall; references as a plain grey silhouette. */
function Figure({ item, h }: { item: SizeItem; h: number }) {
  const d = dims(item);
  const w = Math.max(3, (h * d.w) / d.h);
  if (item.kind === "ref") {
    // An adult human: head and body.
    const hh = Math.max(4, h);
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: Math.max(4, hh * 0.32), height: hh }}>
        <div style={{ display: "flex", width: hh * 0.16, height: hh * 0.16, borderRadius: hh, background: "#9aa3b4" }} />
        <div style={{ display: "flex", width: hh * 0.3, height: hh * 0.82, marginTop: hh * 0.02, borderRadius: hh * 0.08, background: "#9aa3b4" }} />
      </div>
    );
  }
  const s = h / item.bh;
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: Math.max(3, h), overflow: "hidden" }}>
      <img src={homeRenderUrl(item.art)} width={item.bs * s} height={item.bs * s} style={{ position: "absolute", left: -item.bx * s, top: -item.by * s }} />
    </div>
  );
}

/** Figures at true relative scale, the tallest `H` px, fitted to the card's width. */
function Lineup({ items }: { items: SizeItem[] }) {
  const ds = items.map(dims);
  const gap = 14;
  let k = (H - 20) / Math.max(...ds.map((d) => d.h));
  const width = ds.reduce((a, d) => a + d.w * k, 0) + gap * (items.length - 1);
  if (width > W) k *= (W - gap * (items.length - 1)) / (width - gap * (items.length - 1));
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, justifyContent: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap }}>
        {items.map((it, i) => (
          <Figure key={it.key} item={it} h={Math.max(6, ds[i].h * k)} />
        ))}
      </div>
      <div style={{ display: "flex", height: 4, marginTop: 2, borderRadius: 2, background: `linear-gradient(90deg, ${ACCENT}00, ${ACCENT}, ${ACCENT}00)` }} />
    </div>
  );
}

const human = () => SIZE_ITEMS.find((i) => i.ref?.kind === "human")!;
const sizeText = (i: SizeItem) => `${formatMetres(i.m)}${i.min ? "+" : ""} (${formatFeet(i.m)}${i.min ? "+" : ""})`;

/** A few figures spread evenly (on a log scale) from a line's smallest to its largest. */
export function spread(line: SizeItem[], n: number): SizeItem[] {
  const mons = line.filter((i) => i.kind !== "ref");
  if (mons.length <= n) return mons;
  const lo = Math.log(mons[0].m), hi = Math.log(mons[mons.length - 1].m);
  const out: SizeItem[] = [];
  for (let k = 0; k < n; k++) {
    const target = lo + ((hi - lo) * k) / (n - 1);
    const best = mons.reduce((a, b) => (Math.abs(Math.log(b.m) - target) < Math.abs(Math.log(a.m) - target) ? b : a));
    if (!out.includes(best)) out.push(best);
  }
  return out;
}

export function sizesCard(preset: SizePreset) {
  const line = presetLineup(preset, SIZE_ITEMS);
  const mons = line.filter((i) => i.kind !== "ref");
  const small = mons[0], big = mons[mons.length - 1];
  return ogCard({
    eyebrow: "Pokémon sizes · in 3D",
    title: preset.id === "every-pokemon" ? ["Every Pokémon", ["to scale", ACCENT]] : [preset.label],
    titleSize: preset.label.length > 18 ? 54 : 68,
    subtitle: small && big ? `${mons.length.toLocaleString("en-US")} Pokémon from ${formatMetres(small.m)} to ${formatMetres(big.m)}${big.min ? "+" : ""}, side by side in Lumiose City.` : preset.blurb,
    accent: ACCENT,
    visual: <Lineup items={spread(line, 5)} />,
    footer: "Make your own size video →",
  });
}

export function sizesItemCard(item: SizeItem) {
  const len = item.name.length;
  return ogCard({
    eyebrow: `Pokémon sizes · #${String(item.species).padStart(4, "0")}`,
    title: [item.name],
    titleSize: len > 22 ? 46 : len > 14 ? 58 : 72,
    subtitle: `${sizeText(item)} ${measureOf(item).toLowerCase()}. Next to an adult human, in 3D.`,
    accent: ACCENT,
    visual: <Lineup items={[human(), item].sort((a, b) => a.m - b.m)} />,
    footer: "See it to scale →",
  });
}

export function sizesCompareCard(items: SizeItem[]) {
  const names = items.map((i) => i.name);
  const title = names.join(" vs ");
  return ogCard({
    eyebrow: "Pokémon size comparison",
    title: [title],
    titleSize: title.length > 40 ? 40 : title.length > 26 ? 50 : 64,
    subtitle: items.map((i) => `${i.name} ${formatMetres(i.m)}${i.min ? "+" : ""}`).join(" · "),
    accent: ACCENT,
    visual: <Lineup items={[...items].sort((a, b) => a.m - b.m)} />,
    footer: "Compare them in 3D →",
  });
}
