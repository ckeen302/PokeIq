/**
 * Every animation as a pure function of time, so the stage, the GIF and the video draw exactly the same frame for
 * the same moment.
 *
 * Idle: the ball turns slowly and breathes. Open: it turns to face you, the button flashes, the lid swings up on its
 * rear hinge with an overshooting spring, light bursts out, the opening effect plays and the Pokémon pops out (later
 * it's called back and the lid shuts). Catch: the Pokémon is drawn in, the lid snaps shut, the ball lands, wobbles
 * three times (each shake −16°, 13°, −8°, 4°, as the site's splash does), clicks, and stars burst from it.
 */

const DEG = Math.PI / 180;
/** The lid's resting angle when open (the splash's 48°). */
export const LID_OPEN = 48 * DEG;
export const OPEN_SECONDS = 4.6;
export const CATCH_SECONDS = 5.4;
/** The idle turn's speed (radians a second). */
export const IDLE_SPEED = 0.32;

export interface Pose {
  /** The ball's turn and lean (radians), its height (mm) and squash (1 = none). */
  yaw: number;
  tilt: number;
  y: number;
  squash: number;
  /** A wobble about the ball's base (radians). */
  wobble: number;
  /** The lid's angle (radians, 0 shut). */
  lid: number;
  /** The button lighting up (0..1), and the catch's click (0..1). */
  button: number;
  click: number;
  /** The release burst: how far it has spread (0..1) and how bright it is (0..1). */
  burst: number;
  burstA: number;
  /** Seconds since the opening effect started (< 0: not playing). */
  effectT: number;
  /** The Pokémon: size (0..1), height above the ball's centre (mm), a white flash and the red of being called back. */
  mon: number;
  monY: number;
  monFlash: number;
  monRed: number;
  /** Seconds since the catch's stars burst (< 0: none). */
  starsT: number;
  /** How far the camera has pulled back to fit the Pokémon (0..1). */
  zoom: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
function easeOutBack(x: number) {
  const t = clamp01(x), c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
/** A quick rise and a slower fall, peaking at 1 at `at`. */
const flash = (t: number, at: number, rise: number, fall: number) => (t < at - rise || t > at + fall ? 0 : t < at ? smooth(at - rise, at, t) : 1 - smooth(at, at + fall, t));
/** A spring that starts at 0 and settles at 1 with an overshoot. */
const spring = (k: number) => (k <= 0 ? 0 : 1 - Math.exp(-6 * k) * Math.cos(9 * k));
/** The nearest full turn to `yaw`, where the ball faces the camera. */
export const frontOf = (yaw: number) => Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
const MON_TOP = 54;

export function idlePose(t: number, yaw0 = 0): Pose {
  return {
    yaw: yaw0 + t * IDLE_SPEED,
    tilt: 0.08 + Math.sin(t * 0.9) * 0.025,
    y: Math.sin(t * 1.25) * 0.9,
    squash: 1,
    wobble: 0,
    lid: 0,
    button: 0,
    click: 0,
    burst: 0,
    burstA: 0,
    effectT: -1,
    mon: 0,
    monY: 0,
    monFlash: 0,
    monRed: 0,
    starsT: -1,
    zoom: 0,
  };
}

/** The opening, from the ball turned to `yaw0`. */
export function openPose(t: number, yaw0 = 0): Pose {
  const p = idlePose(0, yaw0);
  const face = frontOf(yaw0);
  p.yaw = yaw0 + (face - yaw0) * easeOut(t / 0.35);
  p.tilt = 0.08 + 0.1 * smooth(0, 0.4, t) * (1 - smooth(3.6, 4.3, t));
  p.squash = 1 - 0.035 * flash(t, 0.28, 0.18, 0.2);
  p.button = flash(t, 0.3, 0.12, 0.35);
  const opening = spring(t - 0.38);
  const closing = smooth(3.7, 4.05, t);
  // Shutting: down onto the rim, then a small bounce.
  p.lid = LID_OPEN * opening * (1 - closing) + (t > 4.05 ? LID_OPEN * 0.06 * Math.sin(clamp01((t - 4.05) / 0.22) * Math.PI) : 0);
  const b = clamp01((t - 0.42) / 0.75);
  p.burst = t >= 0.42 ? easeOut(b) : 0;
  p.burstA = t >= 0.42 && t < 1.17 ? (1 - b) ** 1.6 * smooth(0.42, 0.5, t) : 0;
  p.effectT = t >= 0.5 && t < 3.6 ? t - 0.5 : -1;
  const out = easeOutBack((t - 0.55) / 0.5);
  const back = smooth(3.15, 3.6, t);
  p.mon = t < 0.55 ? 0 : out * (1 - back);
  p.monY = (12 + (MON_TOP - 12) * easeOut((t - 0.55) / 0.5)) * (1 - back) + 4 * back;
  p.monFlash = t < 0.55 ? 0 : 1 - smooth(0.6, 1.05, t);
  p.monRed = smooth(2.95, 3.2, t);
  p.zoom = smooth(0.5, 1.1, t) * (1 - smooth(3.3, 3.9, t));
  p.y = 0;
  return p;
}

/** One shake's keyframes (fraction of the shake, degrees). */
const SHAKE: [number, number][] = [[0, 0], [0.16, -16], [0.38, 13], [0.6, -8], [0.8, 4], [1, 0]];
function shake(f: number): number {
  if (f <= 0 || f >= 1) return 0;
  let k = 0;
  while (k < SHAKE.length - 2 && f > SHAKE[k + 1][0]) k++;
  const [f0, a0] = SHAKE[k], [f1, a1] = SHAKE[k + 1];
  const u = (f - f0) / (f1 - f0);
  // Eased between keyframes, so each swing slows at its extreme.
  return (a0 + (a1 - a0) * (u * u * (3 - 2 * u))) * DEG;
}

/**
 * The catch. `fromOpen`: it follows the opening (the lid is open and the Pokémon out); otherwise the lid flicks open
 * first. `withMon`: there is a Pokémon to draw in.
 */
export function catchPose(t: number, yaw0 = 0, fromOpen = false, withMon = true): Pose {
  const p = idlePose(0, yaw0);
  const face = frontOf(yaw0);
  p.yaw = yaw0 + (face - yaw0) * easeOut(t / 0.3);
  p.tilt = 0.18 - 0.1 * smooth(0.6, 1.2, t);
  const opened = fromOpen ? 1 : smooth(0, 0.16, t);
  const shut = smooth(0.5, 0.74, t);
  p.lid = LID_OPEN * opened * (1 - shut) + (t > 0.74 && t < 0.96 ? LID_OPEN * 0.05 * Math.sin(((t - 0.74) / 0.22) * Math.PI) : 0);
  if (withMon) {
    p.mon = (fromOpen ? 1 : smooth(0, 0.12, t)) * (1 - smooth(0.24, 0.58, t));
    p.monY = MON_TOP * (1 - smooth(0.24, 0.58, t)) + 4;
    p.monRed = smooth(0.04, 0.26, t);
  }
  // A short drop, landing with a squash.
  const drop = smooth(0.76, 0.98, t) * (1 - smooth(0.98, 1.3, t));
  p.y = -3 * drop;
  p.squash = 1 - 0.05 * flash(t, 1.0, 0.04, 0.24);
  p.wobble = [1.45, 2.35, 3.25].reduce((a, s, i) => a + shake((t - s) / 0.62) * [1, 0.85, 0.7][i], 0);
  p.click = flash(t, 4.12, 0.06, 0.55);
  p.button = Math.max(p.click, flash(t, 0.66, 0.06, 0.25) * 0.6);
  p.starsT = t >= 4.16 ? t - 4.16 : -1;
  p.zoom = (fromOpen ? 1 : 0.6 * smooth(0, 0.12, t)) * (1 - smooth(0.4, 1.0, t));
  return p;
}

/** The video's moments (seconds): turning, opening, the catch, and the end card. */
export const VIDEO = { intro: 1.1, open: 3.0, catch: CATCH_SECONDS, outro: 1.3 };
export const VIDEO_SECONDS = VIDEO.intro + VIDEO.open + VIDEO.catch + VIDEO.outro;

/** The whole video as one pose function: a turn into the opening, held open, then caught. */
export function videoPose(t: number, withMon: boolean): Pose {
  const yawStart = -VIDEO.intro * IDLE_SPEED - 0.5;
  if (t < VIDEO.intro) return idlePose(t, yawStart);
  const yaw0 = yawStart + VIDEO.intro * IDLE_SPEED;
  const o = t - VIDEO.intro;
  if (o < VIDEO.open) {
    const p = openPose(o, yaw0);
    if (!withMon) Object.assign(p, { mon: 0, monFlash: 0 });
    return p;
  }
  const c = Math.min(o - VIDEO.open, CATCH_SECONDS);
  const p = catchPose(c, frontOf(yaw0), true, withMon);
  // After the stars, the ball starts to turn again under the end card.
  const after = o - VIDEO.open - CATCH_SECONDS;
  if (after > 0) p.yaw += after * after * 0.25;
  return p;
}
