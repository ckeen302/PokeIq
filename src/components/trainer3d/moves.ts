import type { TauntId } from "@/lib/trainer/taunts";
import type { Joints } from "./model";

/**
 * Post-game dances and emotes, keyframed in code on the trainer rig: each
 * is the joint targets at `t` seconds in (the model eases towards them, so
 * the keys can be coarse). Joint conventions (model.ts): shoulders and legs
 * swing forward with -X; the left arm lifts out with +Z, the right with -Z;
 * elbows bend with -X; +lean tips forward, +nod looks down, +headTilt leans
 * the head to its right; feet tip onto the toes with +X.
 */

type Move = (t: number) => Partial<Joints>;

/** The moment shown as a still (reduced motion): the move's most telling pose. Default: 40% in. */
export const STILL_AT: Partial<Record<TauntId, number>> = { heeltap: 2.65, dab: 0.8, fireshot: 0.22, robot: 0.4, moonwalk: 0.4, hypejump: 0.95, ggwave: 0.5, balltoss: 0.45, slowclap: 0.3, flex: 0.6 };

const TAU = Math.PI * 2;
const { sin, cos, abs, min, max, floor } = Math;
/** 0 → 1 → 0 over each beat. */
const hump = (x: number) => sin((x % 1) * Math.PI);
/** Eases 0 → 1 as x goes from a to b. */
const ramp = (x: number, a: number, b: number) => {
  const u = min(1, max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
/** Left/right versions of a pose (one arm or leg for the other). */
const mirror = (j: Partial<Joints>): Partial<Joints> => ({
  ...j,
  lsX: j.rsX,
  rsX: j.lsX,
  lsZ: j.rsZ === undefined ? undefined : -j.rsZ,
  rsZ: j.lsZ === undefined ? undefined : -j.lsZ,
  leX: j.reX,
  reX: j.leX,
  leZ: j.reZ === undefined ? undefined : -j.reZ,
  reZ: j.leZ === undefined ? undefined : -j.leZ,
  twist: j.twist === undefined ? undefined : -j.twist,
  headTilt: j.headTilt === undefined ? undefined : -j.headTilt,
  spin: j.spin === undefined ? undefined : -j.spin,
});
const clean = (j: Partial<Joints>) => Object.fromEntries(Object.entries(j).filter(([, v]) => v !== undefined)) as Partial<Joints>;

export const MOVES: Record<TauntId, Move> = {
  // ---- dances ----

  /** Heel taps on the beat, arms swinging, then hands up round the eyes like goggles. */
  heeltap: (t) => {
    const b = t * 2.5;
    const side = floor(b) % 2 ? 1 : -1;
    const u = hump(b);
    if (b % 8 >= 6) {
      const bob = hump(b * 2) * 0.03;
      return { lean: 0.04, nod: -0.06, lsX: -2.3, lsZ: 0.12, leX: -0.95, rsX: -2.3, rsZ: -0.12, reX: -0.95, by: bob, drop: -0.02, llZ: 0.05, rlZ: -0.05 };
    }
    return {
      lean: 0.2,
      twist: side * 0.18,
      drop: -0.03 - u * 0.04,
      llX: side > 0 ? -0.75 * u : 0.15 * u,
      lfX: side > 0 ? -0.9 * u : 0,
      rlX: side < 0 ? -0.75 * u : 0.15 * u,
      rfX: side < 0 ? -0.9 * u : 0,
      lsX: side * 1.25 * u - 0.1,
      rsX: -side * 1.25 * u - 0.1,
      lsZ: 0.22,
      rsZ: -0.22,
      leX: -1.0,
      reX: -1.0,
    };
  },

  /** Alternating punches forward and down, the opposite knee popping up, a bounce on every beat. */
  fireshot: (t) => {
    const b = t * 2.2;
    const u = hump(b);
    const punch: Partial<Joints> = {
      lean: 0.22,
      twist: -0.28 * u,
      by: 0.05 * u,
      drop: -0.05,
      rsX: -0.3 - 0.95 * u,
      rsZ: 0.18,
      reX: -0.15,
      lsX: 0.15 + 0.7 * u,
      lsZ: 0.3,
      leX: -1.5,
      llX: -0.85 * u,
      lfX: 0.35 * u,
      rlX: 0.08,
    };
    if (floor(b) % 2) return punch;
    const m = clean(mirror(punch));
    return { ...m, llX: 0.08, lfX: 0, rlX: -0.85 * u, rfX: 0.35 * u };
  },

  /** Straight arms swinging side to side, in front then behind, the hips going the other way. */
  swingfloss: (t) => {
    const w = t * TAU * 1.15;
    const a = sin(w);
    const fb = cos(w) > 0 ? -0.45 : 0.45;
    return { lsZ: 0.3 + 0.6 * a, rsZ: -0.3 + 0.6 * a, lsX: fb, rsX: fb, leX: 0, reX: 0, sway: -0.16 * a, bx: 0.07 * a, twist: 0.1 * a, headTilt: 0.08 * a, by: 0.02 * abs(cos(w)) };
  },

  /** Head into one elbow, the other arm out straight; then the other side. */
  dab: (t) => {
    const p = t % 1.6;
    const on = ramp(p, 0.05, 0.22) * (1 - ramp(p, 1.25, 1.5));
    const pose: Partial<Joints> = {
      rsX: -0.1 - 1.3 * on,
      rsZ: -0.14 + 0.9 * on,
      reX: -0.5 - 0.95 * on,
      lsX: -0.45 * on,
      lsZ: 0.14 + 2.0 * on,
      leX: -0.25 + 0.25 * on,
      nod: 0.2 * on,
      headTilt: 0.32 * on,
      twist: -0.25 * on,
      lean: 0.12 * on,
      drop: -0.03 * on,
    };
    return t % 3.2 < 1.6 ? pose : clean(mirror(pose));
  },

  /** Quick shuffling steps out to the sides, arms pumping. */
  shuffle: (t) => {
    const b = t * 2.6;
    const side = floor(b) % 2 ? 1 : -1;
    const u = hump(b);
    return {
      drop: -0.05,
      by: 0.04 * u,
      lean: 0.1,
      llZ: side > 0 ? 0.5 * u : -0.05,
      llX: side > 0 ? 0.25 * u : -0.15 * u,
      lfX: side > 0 ? 0.4 * u : 0,
      rlZ: side < 0 ? -0.5 * u : 0.05,
      rlX: side < 0 ? 0.25 * u : -0.15 * u,
      rfX: side < 0 ? 0.4 * u : 0,
      bx: side * 0.05 * u,
      lsX: -0.3 + side * 0.5 * u,
      rsX: -0.3 - side * 0.5 * u,
      leX: -1.6,
      reX: -1.6,
      lsZ: 0.25,
      rsZ: -0.25,
      twist: side * 0.12 * u,
    };
  },

  /** Stiff, square moves that snap from one to the next. */
  robot: (t) => {
    const keys: Partial<Joints>[] = [
      { lsZ: 1.45, leZ: 1.5, rsZ: -1.45, reZ: -1.5, twist: 0 },
      { lsZ: 1.45, leZ: 1.5, rsZ: -1.45, reZ: 1.5, twist: 0.35 },
      { lsZ: 1.45, leZ: -1.5, rsZ: -1.45, reZ: 1.5, twist: 0.35, nod: 0.2 },
      { lsX: -1.55, leX: 0, rsX: -1.55, reX: 0, twist: 0 },
      { lsX: -1.55, leX: -1.55, rsX: -0.2, reX: -1.55, twist: -0.35, headTilt: -0.2 },
      { lsX: -0.2, leX: -1.55, rsX: -1.55, reX: -1.55, twist: 0.35, headTilt: 0.2 },
    ];
    const step = floor(t * 3);
    const k = keys[step % keys.length];
    return { lean: 0, nod: 0, leX: 0, reX: 0, leZ: 0, reZ: 0, legZ: 0.12, by: (step % 2) * -0.025, ...k };
  },

  /** One hand behind the head, the other arm out front, ticking across in steps and sweeping back. */
  sprinkler: (t) => {
    const p = (t % 2) / 2;
    const ticks = 7;
    const sweep = p < 0.8 ? -0.55 + (floor((p / 0.8) * (ticks + 1)) / ticks) * 1.1 : 0.55 - ramp(p, 0.8, 1) * 1.1;
    const tick = p < 0.8 ? hump((p / 0.8) * (ticks + 1)) : 0;
    return {
      spin: sweep,
      lsX: -0.6,
      lsZ: 2.5,
      leX: -1.9,
      rsX: -1.5,
      rsZ: -0.05,
      reX: -0.05,
      llX: -0.25 * tick,
      lfX: 0.3 * tick,
      drop: -0.03,
      by: 0.02 * tick,
      nod: -0.05,
    };
  },

  /** Gliding backwards on alternating toes, then a spin on the toes to finish. */
  moonwalk: (t) => {
    const end = 3.4;
    if (t < end) {
      const b = t * 2;
      const side = floor(b) % 2 ? 1 : -1;
      const u = ramp(b % 1, 0, 0.35);
      return {
        bz: 0.12 - (t / end) * 0.5,
        lean: -0.04,
        llX: side > 0 ? -0.12 * u : 0.15 * u,
        lfX: side > 0 ? 0.75 * u : 0,
        rlX: side < 0 ? -0.12 * u : 0.15 * u,
        rfX: side < 0 ? 0.75 * u : 0,
        by: 0.02 * u,
        lsX: 0.2 * side,
        rsX: -0.2 * side,
        leX: -0.5,
        reX: -0.6,
        nod: 0.05,
      };
    }
    const u = ramp(t, end, end + 0.7);
    return { bz: -0.38, spin: u * TAU, lfX: 0.7, rfX: 0.7, by: 0.04, lsZ: 0.4, rsZ: -1.5 + u * 0.3, reX: -1.8, reZ: 0, rsX: -1.0, nod: -0.1 };
  },

  /** A crouch, a jump with both arms up (the second one spinning), and a landing. */
  hypejump: (t) => {
    const period = 1.8;
    const p = (t % period) / period;
    const second = t >= period;
    if (p < 0.3) {
      const c = ramp(p, 0, 0.25);
      return { drop: -0.16 * c, lean: 0.25 * c, lsX: 0.8 * c, rsX: 0.8 * c, lsZ: 0.2, rsZ: -0.2, leX: -0.2, reX: -0.2, nod: 0.1 * c, llX: -0.2 * c, rlX: -0.2 * c };
    }
    if (p < 0.75) {
      const u = (p - 0.3) / 0.45;
      return { by: sin(u * Math.PI) * 0.6, lsZ: 2.6, rsZ: -2.6, lsX: -0.25, rsX: -0.25, leX: -0.1, reX: -0.1, llX: -0.55, rlX: -0.55, lfX: 0.5, rfX: 0.5, nod: -0.25, spin: second ? u * TAU : 0, lean: -0.05 };
    }
    const l = ramp(p, 0.75, 1);
    return { drop: -0.1 * (1 - l), lsZ: 1.1, rsZ: -1.1, leX: -0.6, reX: -0.6, nod: -0.1, spin: second ? TAU : 0 };
  },

  // ---- emotes ----

  /** Both arms up and bent: a double flex, pumped. */
  flex: (t) => {
    const u = 0.5 + 0.5 * sin(t * 7);
    const on = ramp(t, 0, 0.25);
    return { lsZ: 1.45 * on + 0.14, leZ: (1.7 + 0.35 * u) * on, leX: 0, rsZ: -1.45 * on - 0.14, reZ: -(1.7 + 0.35 * u) * on, reX: 0, rsX: 0, lean: -0.08, nod: -0.1, by: 0.015 * u, legZ: 0.16 };
  },

  /** The held ball spun on a fingertip. */
  ballspin: (t) => ({ rsX: -0.95, rsZ: -0.05, reX: -1.5, reZ: 0, lsZ: 0.75, lsX: 0.2, leZ: -1.5, leX: -0.2, nod: -0.16, headTilt: 0.1, sway: 0.04 * sin(t * 2), twist: 0.15 }),

  /** "Too easy": a shrug, palms up, head tilting. */
  tooeasy: (t) => {
    const s = max(0, sin(t * 4.2));
    return { lsZ: 0.35 + 0.25 * s, leX: -1.25, leZ: 0.55, rsZ: -0.35 - 0.25 * s, reX: -1.25, reZ: -0.55, by: 0.03 * s, headTilt: 0.22 * sin(t * 2.1), nod: -0.06, lean: -0.04 };
  },

  /** Slow claps, arms out front. */
  slowclap: (t) => {
    const p = (t % 0.8) / 0.8;
    const close = p < 0.3 ? ramp(p, 0, 0.3) : 1 - ramp(p, 0.35, 1);
    return { lsX: -1.15, rsX: -1.15, leX: -0.75, reX: -0.75, lsZ: 0.45 - 0.75 * close, rsZ: -0.45 + 0.75 * close, nod: 0.08 + 0.05 * close, lean: 0.04 };
  },

  /** The ball tossed high and caught, eyes following it. */
  balltoss: (t) => {
    const p = (t % 1.3) / 1.3;
    const up = p < 0.12 ? ramp(p, 0, 0.12) : 1 - ramp(p, 0.12, 0.4);
    const watch = p < 0.72 ? sin((p / 0.72) * Math.PI) : 0;
    return { rsX: -0.55 - 0.7 * up, reX: -1.0 + 0.5 * up, nod: -0.32 * watch, lean: -0.06 * watch, lsZ: 0.3, by: 0.02 * up };
  },

  /** A big wave, then a little bow. */
  ggwave: (t) => {
    if (t > 1.9) {
      const b = ramp(t, 1.9, 2.15) * (1 - ramp(t, 2.4, 2.6));
      return { lean: 0.38 * b, nod: 0.25 * b, lsZ: 0.2, leX: -0.3, rsZ: -0.2 };
    }
    return { lsX: -0.3, lsZ: 2.3, leX: 0, leZ: 0.35 + 0.45 * sin(t * 10), headTilt: 0.12, nod: -0.04, rsX: -0.3, reX: -1.0 };
  },

  /** A hand over the face, head down, slowly shaking. */
  facepalm: (t) => {
    const on = ramp(t, 0, 0.3);
    return { lsX: -1.85 * on, lsZ: 0.14 - 0.45 * on, leX: -0.25 - 1.85 * on, nod: 0.38 * on, twist: 0.12 * sin(t * 5) * on, drop: -0.02, lean: 0.1 * on };
  },

  /** Standing tall, a hand snapped to the brow. */
  salute: (t) => {
    const on = ramp(t, 0.05, 0.25);
    return { lsX: -0.75 * on, lsZ: 0.14 + 1.15 * on, leX: -0.25 - 2.0 * on, leZ: 0, by: 0.02, legZ: 0.0, nod: -0.06, headTilt: -0.05 * on, rsZ: -0.08, reX: -0.3 };
  },
};
