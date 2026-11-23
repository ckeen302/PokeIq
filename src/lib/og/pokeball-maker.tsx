import "server-only";
import { ogCard } from "@/lib/og/card";
import { rgbToLch } from "@/lib/shiny-maker/color";
import { hexOf, type Design } from "@/lib/pokeball-maker/design";
import { PATTERNS } from "@/lib/pokeball-maker/patterns";
import { ballPreset } from "@/lib/pokeball-maker/presets";

/**
 * The Poké Ball Maker's preview card: the design as the site's flat CSS ball (its colours, a sketch of its
 * markings), its name and its Bag description. Drawn from the link alone.
 */

/** A sketch of a pattern over a half, as gradients Satori can draw (coordinates within the half). */
function marks(d: Design, half: "top" | "bottom"): string | null {
  const l = d.patterns[half];
  if (!l.id) return null;
  const a = hexOf(l.colours[0]);
  const y = (v: number) => (half === "top" ? v : 100 - v);
  switch (PATTERNS[l.id]?.key) {
    case "great":
      return `radial-gradient(ellipse 22% 36% at 16% ${y(70)}%, ${a} 96%, transparent 100%), radial-gradient(ellipse 22% 36% at 84% ${y(70)}%, ${a} 96%, transparent 100%)`;
    case "ultra":
      return `linear-gradient(90deg, transparent 22%, ${a} 22%, ${a} 33%, transparent 33%, transparent 67%, ${a} 67%, ${a} 78%, transparent 78%)`;
    case "master":
      return `radial-gradient(circle at 26% ${y(58)}%, ${a} 11%, transparent 12%), radial-gradient(circle at 74% ${y(58)}%, ${a} 11%, transparent 12%)`;
    case "quick":
    case "beast":
      return `linear-gradient(90deg, transparent 45%, ${a} 45%, ${a} 55%, transparent 55%)`;
    case "heart":
      return `radial-gradient(ellipse 16% 30% at 50% ${y(62)}%, ${a} 96%, transparent 100%)`;
    case "stripes":
    case "sunburst":
    case "checks":
      return `repeating-linear-gradient(90deg, transparent 0%, transparent 14%, ${a} 14%, ${a} 22%)`;
    case "rings":
    case "waves":
    case "zigzag":
    case "chevrons":
    case "dive":
      return `repeating-linear-gradient(180deg, transparent 0%, transparent 22%, ${a} 22%, ${a} 34%)`;
    case "gradient":
    case "flames":
      return `linear-gradient(${half === "top" ? 180 : 0}deg, transparent 20%, ${a} 90%)`;
    case "split":
      return `linear-gradient(90deg, transparent 50%, ${a} 50%)`;
    default:
      return `radial-gradient(circle at 25% ${y(45)}%, ${a} 7%, transparent 8%), radial-gradient(circle at 62% ${y(30)}%, ${a} 7%, transparent 8%), radial-gradient(circle at 76% ${y(72)}%, ${a} 7%, transparent 8%), radial-gradient(circle at 40% ${y(80)}%, ${a} 7%, transparent 8%)`;
  }
}

function Ball({ d, size }: { d: Design; size: number }) {
  const band = hexOf(d.colours.band);
  const topM = marks(d, "top"), botM = marks(d, "bottom");
  const half = size * 0.45, bandH = size * 0.1;
  const ring = size * 0.3, button = size * 0.18;
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size, borderRadius: size / 2, overflow: "hidden", border: "4px solid rgba(0,0,0,0.6)", boxShadow: "0 30px 60px rgba(0,0,0,0.55)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: size, height: half, display: "flex", background: hexOf(d.colours.top) }} />
      {topM && <div style={{ position: "absolute", left: 0, top: 0, width: size, height: half, display: "flex", backgroundImage: topM }} />}
      <div style={{ position: "absolute", left: 0, top: half, width: size, height: bandH, display: "flex", background: band }} />
      <div style={{ position: "absolute", left: 0, top: half + bandH, width: size, height: size - half - bandH, display: "flex", background: hexOf(d.colours.bottom) }} />
      {botM && <div style={{ position: "absolute", left: 0, top: half + bandH, width: size, height: size - half - bandH, display: "flex", backgroundImage: botM }} />}
      {/* Shading and a highlight, so it reads as round. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: size, height: size, display: "flex", backgroundImage: "radial-gradient(circle at 34% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 26%), radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.22) 74%)" }} />
      <div style={{ position: "absolute", left: (size - ring) / 2, top: (size - ring) / 2, width: ring, height: ring, borderRadius: ring / 2, display: "flex", background: hexOf(d.colours.ring), alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: button, height: button, borderRadius: button / 2, display: "flex", background: hexOf(d.colours.button), border: "3px solid rgba(0,0,0,0.25)" }} />
      </div>
    </div>
  );
}

export async function pokeballMakerCard(d: Design | null) {
  const design = d ?? ballPreset("poke");
  // The card's accent: the design's most colourful light part.
  const cols = [design.colours.top, design.colours.bottom, design.patterns.top.id ? design.patterns.top.colours[0] : design.colours.top];
  const vivid = cols.map((c) => ({ c, l: rgbToLch(c[0], c[1], c[2]) })).filter((x) => x.l.l > 0.5).sort((a, b) => b.l.c - a.l.c)[0];
  const accent = vivid && vivid.l.c > 0.06 ? hexOf(vivid.c) : "#ef4f5a";
  const glow = hexOf(design.colours.top);
  const visual = (
    <div style={{ display: "flex", position: "relative", width: 440, height: 400, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", left: 20, top: 0, width: 400, height: 400, display: "flex", borderRadius: 200, backgroundImage: `radial-gradient(circle, ${glow}66 0%, ${glow}1a 50%, ${glow}00 70%)` }} />
      <Ball d={design} size={300} />
    </div>
  );
  if (!d) {
    return ogCard({ eyebrow: "PokéIQ tools", title: ["Poké Ball", ["Maker", accent]], subtitle: "Design your own Poké Ball in 3D.", accent, visual, footer: "Design your own →" });
  }
  const title = d.name || "Custom Ball";
  return ogCard(
    {
      eyebrow: "Poké Ball Maker",
      title: [title],
      titleSize: title.length > 18 ? 46 : title.length > 12 ? 58 : 70,
      subtitle: d.desc ? (d.desc.length > 110 ? `${d.desc.slice(0, 108)}…` : d.desc) : "A custom Poké Ball, made on PokéIQ.",
      accent,
      visual,
      footer: "Design your own →",
    },
    { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" }
  );
}


