/**
 * How each figure moves on the battlefield (looks only; the simulation
 * moves the bodies). The ideas come from Pokémon Race's gait model:
 *
 * - Strides follow R. McNeill Alexander's dynamic similarity ("Estimates of
 *   speeds of dinosaurs", Nature 261, 1976): relative stride length
 *   λ = 2.3 · (v² / (g·h))^0.3 with h the hip height, so at one speed a
 *   small Pokémon patters and a giant lopes.
 * - How a Pokémon moves comes from its PokéAPI body shape, types and
 *   ability: Levitate and floating Ghosts hover, Flying types fly low,
 *   serpents slither, fish flop, balls roll, blobs bounce, the rest run.
 */

export type Motion = "run" | "gallop" | "hover" | "fly" | "slither" | "flop" | "bounce";

const G = 9.81;
const HIP: Record<string, number> = { upright: 0.48, humanoid: 0.5, legs: 0.55, quadruped: 0.62, armor: 0.4 };

/** Doduo and Dodrio can't fly well and run instead. */
const FLIGHTLESS = new Set([84, 85]);
const FLOATING = new Set(["blob", "ball", "arms", "tentacles", "heads"]);

export function motionFor(p: { id: number; shape: string | null; types: string[]; ability: string }): Motion {
  const shape = p.shape ?? "";
  if (p.ability === "Levitate") return "hover";
  if (p.types.includes("ghost") && FLOATING.has(shape)) return "hover";
  if (!FLIGHTLESS.has(p.id) && (p.types.includes("flying") || shape === "wings" || shape === "bug-wings")) return "fly";
  if (shape === "squiggle") return "slither";
  if (shape === "fish") return "flop";
  if (shape === "ball" || shape === "blob" || shape === "heads") return "bounce";
  if (shape === "quadruped") return "gallop";
  return "run";
}

/** Strides (or hops, wingbeats…) per second at `v` m/s for a figure `h` metres tall, capped so it never blurs. */
export function cycleHz(motion: Motion, v: number, h: number, shape: string | null): number {
  if (v <= 0.05) return 0;
  if (motion === "hover") return 0.6;
  if (motion === "fly") return Math.min(9, 3 + 4 / Math.max(0.3, Math.sqrt(h)));
  const hip = Math.max(0.03, h * (HIP[shape ?? ""] ?? 0.5));
  const lambda = 2.3 * Math.pow((v * v) / (G * hip), 0.3);
  const f = v / Math.max(0.01, lambda * hip);
  return Math.min(motion === "gallop" ? 5 : 8, f * (motion === "run" ? 2 : 1));
}

/** Height of the bob (share of the figure's height) for a motion at full stride. */
export const BOB: Record<Motion, number> = { run: 0.06, gallop: 0.08, hover: 0.04, fly: 0.05, slither: 0.02, flop: 0.12, bounce: 0.16 };

/** How high a hovering or flying figure floats (share of its height). */
export const FLOAT: Record<Motion, number> = { run: 0, gallop: 0, hover: 0.18, fly: 0.45, slither: 0, flop: 0, bounce: 0 };
