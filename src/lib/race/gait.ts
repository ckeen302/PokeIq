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
 * Swimming: Pokémon that can't move on land race in a pool lane. The
 * tail beats at the rate R. Bainbridge measured in swimming fish ("The
 * speed of swimming of fish as related to size and to the frequency and
 * amplitude of the tail beat", J. Exp. Biol. 35, 1958): speed ≈ 0.75 ×
 * body length × tail-beat frequency (his U = ¼·L·(3f − 4) at the beat
 * rates fish sprint at), so a big swimmer beats slowly and a small one
 * fast. Fish swim with a carangiform wave (the undulation grows towards
 * the tail), serpents with an anguilliform one (the whole body waves).
 *
 * A running step has a stance, when the foot is down and the body sinks
 * and then pushes off, and a flight, when both feet are up. Sprinters
 * spend about 40% of a step on the ground, joggers over half (contact
 * time shortens with speed: P. G. Weyand et al., "Faster top running
 * speeds are achieved with greater ground forces not more rapid leg
 * movements", J. Appl. Physiol. 89, 2000).
 *
 * How a Pokémon moves comes from its PokéAPI body shape, types and
 * abilities: Levitate and floating Ghosts hover, Flying types and winged
 * shapes fly low over their lane, fish and legless Water types (serpent
 * and tentacled bodies) swim, other serpents slither, balls roll, blobs
 * bounce, quadrupeds gallop, many-legged and armoured bodies scuttle, and
 * everything with legs runs.
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
export const MAX_CYCLE_HZ: Record<Motion, number> = { run: 9, gallop: 6, scuttle: 12, fly: 12, hover: 1, slither: 4, flop: 4, roll: 99, bounce: 5, swim: 6 };

/** Bainbridge (1958): speed ≈ 0.75 × body length × tail-beat frequency. */
export const BAINBRIDGE = 0.75;

/** Tail beats per second for a swimmer of body length `len` (m) at speed v (m/s). */
export const tailBeatHz = (v: number, len: number) => (v <= 0 ? 0 : v / (BAINBRIDGE * Math.max(0.05, len)));

/** Shapes that swim when they can't fly or float: fish, and serpents and tentacled bodies of Water types. */
const SWIM_WATER_SHAPES = new Set(["squiggle", "tentacles"]);

/** How a swimmer's body waves: fish carangiform, serpents anguilliform, tentacled bodies pulse. */
export type SwimStyle = "carangiform" | "anguilliform" | "pulse";
export function swimStyle(shape: string | null): SwimStyle {
  if (shape === "squiggle") return "anguilliform";
  if (shape === "tentacles") return "pulse";
  return "carangiform";
}

/** Share of a running step with a foot on the ground (about 0.4 at a sprint, over half at a jog). */
export const contactShare = (effort: number) => 0.58 - 0.18 * Math.max(0, Math.min(1, effort));

/** Doduo and Dodrio are Flying types that can't fly well and run instead (Pokédex: "makes up for its poor flying with its fast foot speed"). */
export const FLIGHTLESS = new Set([84, 85]);

const FLOATING_SHAPES = new Set(["blob", "ball", "arms", "tentacles", "heads"]);

/** How a Pokémon moves down its lane. */
export function motionFor(p: { shape: string | null; types: string[]; abilities: string[]; species: number }): Motion {
  const shape = p.shape ?? "";
  if (p.abilities.includes("levitate")) return "hover";
  if (p.types.includes("ghost") && FLOATING_SHAPES.has(shape)) return "hover";
  if (!FLIGHTLESS.has(p.species) && (p.types.includes("flying") || shape === "wings" || shape === "bug-wings")) return "fly";
  // Can't move on land: a pool lane.
  if (shape === "fish" || (p.types.includes("water") && SWIM_WATER_SHAPES.has(shape))) return "swim";
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
  swim: "Swims",
};

/** Ground contact: these gaits strike the ground, so heavy runners shake it. */
export const GROUNDED = new Set<Motion>(["run", "gallop", "scuttle", "slither", "flop", "roll", "bounce"]);

/**
 * Gait cycles per second at speed v, as drawn: footfalls for runners and
 * scuttlers (two per stride), bounds for gallopers, hops for bouncers and
 * floppers, body waves for serpents, wingbeats for fliers, tail beats for
 * swimmers (`len`, the body length, for Bainbridge's relation).
 */
export function cycleRate(motion: Motion, v: number, hip: number, kg: number, len = hip * 2): number {
  let f: number;
  switch (motion) {
    case "swim":
      f = tailBeatHz(v, len);
      break;
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

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function poseFor(motion: Motion, o: { phase: number; v: number; a: number; h: number; hip: number; distance: number; time: number }): Pose {
  const { phase, v, a, h, hip } = o;
  const fr = froude(v, hip);
  const effort = Math.min(1, fr / 6);
  const cyc = phase - Math.floor(phase);
  const lean = Math.atan2(Math.max(-3, Math.min(12, a)), G) * 0.8 + (v > 0 ? 0.06 * effort : 0);
  const out: Pose = { lift: 0, lean, pitch: 0, squash: 0, wave: 0, spin: 0, flap: 1 };
  switch (motion) {
    case "run": {
      // Each step: stance (the foot down: the body sinks, then pushes off and stretches) and flight (both feet up, a short arc), landing compressed.
      const duty = contactShare(effort);
      const amp = Math.min(1, v / 1.5);
      if (cyc < duty) {
        const u = cyc / duty;
        // Compression peaks mid-stance; the push-off stretches the body over the last third.
        out.squash = amp * (-(0.03 + 0.05 * effort) * Math.sin(Math.PI * Math.min(1, u * 1.25)) + (0.02 + 0.045 * effort) * smoothstep(0.62, 1, u));
        out.lift = 0;
        out.pitch = 0.03 * effort * (u - 0.5);
      } else {
        const u = (cyc - duty) / (1 - duty);
        out.lift = amp * hip * (0.02 + 0.075 * effort) * 4 * u * (1 - u);
        // Stretched off the ground, relaxing through the air, bracing for the landing.
        out.squash = amp * ((0.02 + 0.045 * effort) * (1 - smoothstep(0, 0.55, u)) - 0.015 * effort * smoothstep(0.75, 1, u));
        out.pitch = -0.02 * effort * Math.sin(Math.PI * u);
      }
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
    case "swim": {
      // Level in the water, the body wave drives it (drawn in the vertex shader); a small heave with each beat.
      out.lift = 0.012 * h * Math.sin(4 * Math.PI * cyc);
      out.wave = Math.sin(2 * Math.PI * cyc);
      out.lean = 0;
      out.pitch = 0.015 * Math.sin(2 * Math.PI * cyc + 1.2);
      break;
    }
  }
  return out;
}
