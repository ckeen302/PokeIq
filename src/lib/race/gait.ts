import { G } from "./model";
import type { Motion } from "./types";

/**
 * How each runner moves, from real biomechanics. Pure and unit-tested
 * (tests/race-gait.test.ts).
 *
 * Gait: R. McNeill Alexander's dynamic similarity ("Estimates of speeds of
 * dinosaurs", Nature 261, 1976): animals of any size move alike at the
 * same Froude number v² / (g·h), with h the hip height, and the relative
 * stride length is λ = 2.3 · (v² / (g·h))^0.3. So a stride is λ·h long and
 * strides come at v / (λ·h) a second: at the same speed a small Pokémon
 * patters and a giant lopes. The bob, lean, squash and footfalls of each
 * runner follow from this.
 *
 * Wingbeats follow geometric similarity (A. V. Hill, 1950: frequency ∝
 * length⁻¹ ∝ mass^(−1/3)), anchored to a pigeon's ~7 beats a second at
 * 0.4 kg.
 *
 * How a Pokémon moves comes from its PokéAPI body shape, types and
 * abilities: Levitate and floating Ghosts hover, Flying types and winged
 * shapes fly low over their lane, serpents slither, fish flop, balls roll,
 * blobs bounce, quadrupeds gallop, many-legged and armoured bodies
 * scuttle, and everything with legs runs.
 */

export const ALEXANDER = { k: 2.3, exp: 0.3 } as const;

/** Hip height as a share of standing height, by body shape (legs up to the hip joint; the reference point for non-legged bodies). */
const HIP_SHARE: Record<string, number> = {
  upright: 0.48,
  humanoid: 0.5,
  legs: 0.55,
  quadruped: 0.62,
  armor: 0.4,
  arms: 0.42,
  tentacles: 0.42,
  heads: 0.45,
  "bug-wings": 0.45,
  wings: 0.45,
  ball: 0.5,
  blob: 0.5,
  fish: 0.5,
  squiggle: 0.5,
};

/** Hip height (m) from the figure's standing height and body shape. */
export function hipHeight(standing: number, shape: string | null): number {
  return Math.max(0.02, standing * (HIP_SHARE[shape ?? ""] ?? 0.5));
}

/** Froude number v² / (g·h). */
export const froude = (v: number, h: number) => (v * v) / (G * Math.max(1e-3, h));

/** Alexander's relative stride length λ = 2.3 · Fr^0.3 (stride length / hip height). */
export const relativeStride = (v: number, h: number) => (v <= 0 ? 0 : ALEXANDER.k * Math.pow(froude(v, h), ALEXANDER.exp));

/** Stride length (m): one full cycle of the legs (two steps for a biped). */
export const strideLength = (v: number, h: number) => relativeStride(v, h) * h;

/** Strides per second. */
export const strideFrequency = (v: number, h: number) => (v <= 0 ? 0 : v / strideLength(v, h));

/** Wingbeats per second for a flier of `kg` (geometric similarity, ~7 Hz at 0.4 kg). */
export const wingbeatHz = (kg: number) => 7 * Math.pow(Math.max(0.01, kg) / 0.4, -1 / 3);

/** Display limits: faster cycles than this alias into a blur on a 30–60 fps screen. */
export const MAX_CYCLE_HZ: Record<Motion, number> = { run: 9, gallop: 6, scuttle: 12, fly: 12, hover: 1, slither: 4, flop: 4, roll: 99, bounce: 5 };

/** Doduo and Dodrio are Flying types that can't fly well and run instead (Pokédex: "makes up for its poor flying with its fast foot speed"). */
export const FLIGHTLESS = new Set([84, 85]);

const FLOATING_SHAPES = new Set(["blob", "ball", "arms", "tentacles", "heads"]);

/** How a Pokémon moves down its lane. */
export function motionFor(p: { shape: string | null; types: string[]; abilities: string[]; species: number }): Motion {
  const shape = p.shape ?? "";
  if (p.abilities.includes("levitate")) return "hover";
  if (p.types.includes("ghost") && FLOATING_SHAPES.has(shape)) return "hover";
  if (!FLIGHTLESS.has(p.species) && (p.types.includes("flying") || shape === "wings" || shape === "bug-wings")) return "fly";
  switch (shape) {
    case "squiggle":
      return "slither";
    case "fish":
      return "flop";
    case "ball":
      return "roll";
    case "blob":
      return "bounce";
    case "quadruped":
      return "gallop";
    case "armor":
    case "arms":
    case "tentacles":
      return "scuttle";
    case "heads":
      return "bounce";
    default:
      return "run";
  }
}

export const MOTION_LABEL: Record<Motion, string> = {
  run: "Runs",
  gallop: "Gallops",
  scuttle: "Scuttles",
  fly: "Flies",
  hover: "Hovers",
  slither: "Slithers",
  flop: "Flops",
  roll: "Rolls",
  bounce: "Bounces",
};

/** Ground contact: these gaits strike the ground, so heavy runners shake it. */
export const GROUNDED = new Set<Motion>(["run", "gallop", "scuttle", "slither", "flop", "roll", "bounce"]);

/**
 * Gait cycles per second at speed v, as drawn: footfalls for runners and
 * scuttlers (two per stride), bounds for gallopers, hops for bouncers and
 * floppers, body waves for serpents, wingbeats for fliers.
 */
export function cycleRate(motion: Motion, v: number, hip: number, kg: number): number {
  let f: number;
  switch (motion) {
    case "fly":
      f = wingbeatHz(kg);
      break;
    case "hover":
      f = 0.7;
      break;
    case "run":
    case "scuttle":
      f = 2 * strideFrequency(v, hip);
      break;
    case "roll":
      // Turns per second of a ball as tall as the figure (rolling without slipping).
      f = v / (Math.PI * Math.max(0.05, hip * 2));
      break;
    default:
      f = strideFrequency(v, hip);
  }
  return Math.min(MAX_CYCLE_HZ[motion], f);
}

/** How high a flier or hoverer travels over its lane (m), from its height. */
export function cruiseHeight(motion: Motion, h: number): number {
  if (motion === "fly") return 0.35 + 0.22 * h;
  if (motion === "hover") return 0.18 + 0.12 * h;
  return 0;
}

/**
 * The pose of a runner at one instant, from its gait: vertical lift (m),
 * forward lean (radians, from acceleration: a sprinter leans by about
 * atan(a/g)), body pitch for bounding gaits, squash (−) and stretch (+) of
 * the figure, lateral wave for serpents, and in-plane roll for balls.
 */
export interface Pose {
  lift: number;
  lean: number;
  pitch: number;
  squash: number;
  wave: number;
  spin: number;
  /** Width pulse for wingbeats (1 = rest). */
  flap: number;
}

export function poseFor(motion: Motion, o: { phase: number; v: number; a: number; h: number; hip: number; distance: number; time: number }): Pose {
  const { phase, v, a, h, hip } = o;
  const fr = froude(v, hip);
  const effort = Math.min(1, fr / 6);
  const cyc = phase - Math.floor(phase);
  const lean = Math.atan2(Math.max(-3, Math.min(12, a)), G) * 0.8 + (v > 0 ? 0.06 * effort : 0);
  const out: Pose = { lift: 0, lean, pitch: 0, squash: 0, wave: 0, spin: 0, flap: 1 };
  switch (motion) {
    case "run": {
      // A bounce per step: highest mid-flight, a squash at each footfall.
      const s = Math.sin(Math.PI * cyc);
      out.lift = hip * (0.02 + 0.06 * effort) * s;
      out.squash = (0.05 * effort) * (Math.pow(1 - s, 6) - 0.15);
      break;
    }
    case "scuttle": {
      const s = Math.abs(Math.sin(Math.PI * cyc));
      out.lift = hip * 0.035 * s * Math.min(1, effort * 2 + 0.2);
      out.squash = 0.025 * Math.min(1, effort * 2) * (Math.pow(1 - s, 4) - 0.2);
      out.lean *= 0.4;
      break;
    }
    case "gallop": {
      // A bound per stride: the body arcs, nose down on landing and up at take-off.
      const s = Math.sin(Math.PI * cyc);
      out.lift = hip * (0.03 + 0.12 * effort) * s;
      out.pitch = 0.16 * effort * Math.sin(2 * Math.PI * cyc);
      out.squash = 0.06 * effort * (Math.pow(1 - s, 5) - 0.12);
      break;
    }
    case "bounce": {
      const s = Math.sin(Math.PI * cyc);
      out.lift = (v > 0 ? hip * (0.12 + 0.3 * effort) : hip * 0.02) * s;
      out.squash = (v > 0 ? 0.12 : 0.03) * (Math.pow(1 - s, 8) * 1.4 - 0.25 * s);
      out.lean *= 0.3;
      break;
    }
    case "flop": {
      // Leaps in arcs, tipping nose-down into each landing.
      const s = Math.sin(Math.PI * cyc);
      out.lift = (v > 0 ? h * (0.15 + 0.25 * effort) : 0) * s;
      out.pitch = v > 0 ? -0.5 * Math.cos(Math.PI * cyc) * Math.min(1, effort * 3) : 0.05 * Math.sin(o.time * 7);
      out.squash = 0.08 * Math.pow(1 - s, 8);
      out.lean = 0;
      break;
    }
    case "slither": {
      out.wave = Math.sin(2 * Math.PI * cyc);
      out.lift = 0;
      out.lean *= 0.2;
      break;
    }
    case "roll": {
      // Turns as it rolls: angle = distance / radius.
      out.spin = -o.distance / Math.max(0.05, h / 2);
      out.lift = Math.abs(Math.sin(o.distance * 3)) * 0.01 * h;
      out.lean = 0;
      break;
    }
    case "fly": {
      const beat = Math.sin(2 * Math.PI * cyc);
      out.lift = cruiseHeight("fly", h) * Math.min(1, o.time > 0 ? o.distance / 4 + 0.15 : 0) + 0.035 * h * beat;
      out.flap = 1 + 0.07 * beat;
      out.lean = Math.atan2(Math.max(-3, Math.min(12, a)), G) * 0.5 + 0.12 * Math.min(1, v / 8);
      break;
    }
    case "hover": {
      out.lift = cruiseHeight("hover", h) + 0.04 * h * Math.sin(o.time * 2 * Math.PI * 0.7);
      out.lean *= 0.5;
      break;
    }
  }
  return out;
}
