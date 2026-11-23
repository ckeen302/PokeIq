/**
 * A design as a flat CSS ball (the site's CSS Poké Ball, components/battle/play/PokeBall.tsx): the Start tab's
 * tiles, the page without WebGL 2, and the server-drawn preview card. The markings are a simple sketch of each
 * pattern; the 3D stage draws the real thing.
 */
import { ballLayers } from "@/components/battle/play/PokeBall";
import { hexOf, type Design, type PatternLayer } from "./design";
import { PATTERNS } from "./patterns";

function marks(l: PatternLayer): string[] {
  if (!l.id) return [];
  const [a, b] = l.colours.map(hexOf);
  switch (PATTERNS[l.id]?.key) {
    case "great":
      return [`radial-gradient(ellipse 22% 34% at 18% 66%, ${a} 98%, transparent)`, `radial-gradient(ellipse 22% 34% at 82% 66%, ${a} 98%, transparent)`];
    case "ultra":
      return [`linear-gradient(90deg, transparent 22%, ${a} 22% 33%, transparent 33% 67%, ${a} 67% 78%, transparent 78%)`];
    case "master":
      return [`radial-gradient(circle at 26% 58%, ${a} 10%, transparent 11%)`, `radial-gradient(circle at 74% 58%, ${a} 10%, transparent 11%)`];
    case "quick":
    case "beast":
      return [`linear-gradient(90deg, transparent 45%, ${a} 45% 55%, transparent 55%)`, `linear-gradient(transparent 40%, ${a} 40% 52%, transparent 52%)`];
    case "heart":
      return [`radial-gradient(ellipse 16% 30% at 50% 64%, ${a} 98%, transparent)`];
    case "crescent":
      return [`radial-gradient(circle at 56% 52%, transparent 14%, ${a} 15% 24%, transparent 25%)`];
    case "stripes":
    case "sunburst":
    case "checks":
      return [`repeating-linear-gradient(90deg, transparent 0 14%, ${a} 14% 22%)`];
    case "rings":
    case "waves":
    case "zigzag":
    case "chevrons":
    case "dive":
      return [`repeating-linear-gradient(180deg, transparent 0 22%, ${a} 22% 34%)`];
    case "flames":
      return [`linear-gradient(transparent 50%, ${a} 50% 78%, ${b} 78%)`];
    case "gradient":
      return [`linear-gradient(transparent 10%, ${a} 80%)`];
    case "split":
      return [`linear-gradient(90deg, transparent 50%, ${a} 50%)`];
    case "net":
    case "plaid":
    case "argyle":
      return [`repeating-linear-gradient(45deg, transparent 0 10%, ${a} 10% 13%)`, `repeating-linear-gradient(-45deg, transparent 0 10%, ${a} 10% 13%)`];
    case "galaxy":
      return [`radial-gradient(circle at 30% 40%, ${a}, transparent 45%)`, `radial-gradient(circle at 70% 70%, ${b}, transparent 40%)`];
    default:
      // Motifs (dots, stars, hearts, scales…): a scatter of dots.
      return [`radial-gradient(circle at 25% 45%, ${a} 7%, transparent 8%)`, `radial-gradient(circle at 60% 30%, ${a} 7%, transparent 8%)`, `radial-gradient(circle at 75% 70%, ${a} 7%, transparent 8%)`, `radial-gradient(circle at 40% 80%, ${a} 7%, transparent 8%)`];
  }
}

export function ballCss(d: Design): string {
  return ballLayers({
    top: hexOf(d.colours.top),
    bottom: hexOf(d.colours.bottom),
    band: hexOf(d.colours.band),
    ring: hexOf(d.colours.ring),
    button: hexOf(d.colours.button),
    marks: marks(d.patterns.top),
    bottomMarks: marks(d.patterns.bottom).map((m) => m.replace(/at (\d+)% (\d+)%/g, (_, x, y) => `at ${x}% ${100 - Number(y)}%`)),
  });
}

/** The shading laid over a CSS ball so it reads as round. */
export const BALL_SHADE = "inset -6px -10px 16px rgb(0 0 0 / 0.32), inset 4px 6px 10px rgb(255 255 255 / 0.18)";
