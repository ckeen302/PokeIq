/**
 * The race model: how fast a Pokémon runs, from its base stats. Pure and
 * unit-tested (tests/race-model.test.ts).
 *
 * Pokémon have no official real-world speeds, so every speed here is scaled
 * from the Speed stat, with base 100 Speed set to 10 m/s, a world-class
 * sprinter's top speed:
 *
 * - Top speed: v_max = 10 m/s × Speed / 100. Regieleki (200) reaches
 *   20 m/s, Shuckle (5) 0.5 m/s.
 * - Acceleration: the sprint model of Furusawa, Hill and Parkinson (1927),
 *   v(t) = v_max · (1 − e^(−t/τ)), so x(t) = v_max · (t − τ(1 − e^(−t/τ))).
 *   τ, the time it takes to get going, comes from power-to-weight:
 *   τ = 1.3 s × (kg / 70)^0.1 × (100 / Attack)^0.15, between 0.6 s and 4 s.
 *   A 70 kg runner with 100 Attack has a human sprinter's τ of 1.3 s;
 *   heavier Pokémon take longer to reach top speed, stronger ones less.
 *   The exponents are kept small on purpose, so base Speed decides the
 *   race and Pokémon with equal Speed are separated by their start.
 * - Endurance (200 m and 400 m): base HP is stamina. After 150 m, about
 *   where real sprinters start to tie up, the speed a runner can hold fades
 *   towards 65% of its top speed over an endurance distance of
 *   400 m × (HP / 100)^0.8. With 100 HP a runner keeps about 96% of its top
 *   speed at 200 m and 84% at 400 m, like an elite 400 m runner; Blissey
 *   (255 HP) barely fades; Shedinja (1 HP) runs out of steam within metres.
 *   The speed follows the falling ceiling with the same τ:
 *   dv/dt = (v_ceiling(x) − v) / τ, integrated with RK4.
 * - Finish time: the time T where x(T) = the race distance (closed form
 *   and Newton's method before fatigue, the integrated curve after).
 */

export const G = 9.81;
/** m/s per point of base Speed (100 Speed = 10 m/s). */
export const SPEED_PER_POINT = 0.1;

export const ACCEL = { tau0: 1.3, kg0: 70, atk0: 100, kgExp: 0.1, atkExp: 0.15, min: 0.6, max: 4 } as const;
export const FADE = { onset: 150, floor: 0.65, ref: 400, hpExp: 0.8 } as const;

export interface Runner {
  /** Top speed (m/s). */
  vmax: number;
  /** Time constant of the sprint start (s). */
  tau: number;
  /** Where fatigue begins (m). */
  onset: number;
  /** Share of top speed a fully tired runner still holds. */
  floor: number;
  /** Distance over which the fade runs its course (m), from HP. */
  endurance: number;
}

export const topSpeed = (spe: number) => Math.max(0, spe) * SPEED_PER_POINT;

export function tauFor(kg: number, atk: number): number {
  const t = ACCEL.tau0 * Math.pow(Math.max(0.1, kg) / ACCEL.kg0, ACCEL.kgExp) * Math.pow(ACCEL.atk0 / Math.max(1, atk), ACCEL.atkExp);
  return Math.min(ACCEL.max, Math.max(ACCEL.min, t));
}

export const enduranceFor = (hp: number) => FADE.ref * Math.pow(Math.max(1, hp) / 100, FADE.hpExp);

export function runnerFor(stats: { spe: number; atk: number; hp: number }, kg: number): Runner {
  return { vmax: topSpeed(stats.spe), tau: tauFor(kg, stats.atk), onset: FADE.onset, floor: FADE.floor, endurance: enduranceFor(stats.hp) };
}

/** Speed before fatigue (Furusawa / Hill). */
export function sprintV(r: Runner, t: number): number {
  return t <= 0 ? 0 : r.vmax * (1 - Math.exp(-t / r.tau));
}

/** Distance before fatigue (Furusawa / Hill). */
export function sprintX(r: Runner, t: number): number {
  return t <= 0 ? 0 : r.vmax * (t - r.tau * (1 - Math.exp(-t / r.tau)));
}

/** Time to cover d metres on the fresh sprint curve (Newton's method on x(t) = d). */
export function timeToCover(r: Runner, d: number): number {
  if (d <= 0) return 0;
  if (r.vmax <= 0) return Infinity;
  let t = d / r.vmax + r.tau;
  for (let i = 0; i < 60; i++) {
    const f = sprintX(r, t) - d;
    const fp = Math.max(1e-9, sprintV(r, t));
    const next = Math.max(1e-6, t - f / fp);
    if (Math.abs(next - t) < 1e-12) { t = next; break; }
    t = next;
  }
  return t;
}

/** The speed a runner can hold at distance x (fatigue after the onset). */
export function ceilingAt(r: Runner, x: number): number {
  if (x <= r.onset) return r.vmax;
  return r.vmax * (r.floor + (1 - r.floor) * Math.exp(-(x - r.onset) / r.endurance));
}

const RK_DT = 0.01;

/** One RK4 step of dx/dt = v, dv/dt = (ceiling(x) − v) / τ. */
function rk4(r: Runner, x: number, v: number, h: number): [number, number] {
  const f = (xx: number, vv: number) => (ceilingAt(r, xx) - vv) / r.tau;
  const k1x = v, k1v = f(x, v);
  const k2x = v + (h / 2) * k1v, k2v = f(x + (h / 2) * k1x, v + (h / 2) * k1v);
  const k3x = v + (h / 2) * k2v, k3v = f(x + (h / 2) * k2x, v + (h / 2) * k2v);
  const k4x = v + h * k3v, k4v = f(x + h * k3x, v + h * k3v);
  return [x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x), v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)];
}

/** Cubic Hermite crossing: the fraction s in [0, 1] of a step where x reaches d. */
function hermiteCross(x0: number, v0: number, x1: number, v1: number, h: number, d: number): number {
  let s = (d - x0) / Math.max(1e-12, x1 - x0);
  for (let i = 0; i < 30; i++) {
    const s2 = s * s, s3 = s2 * s;
    const x = (2 * s3 - 3 * s2 + 1) * x0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * x1 + (s3 - s2) * h * v1;
    const dx = ((6 * s2 - 6 * s) * x0 + (3 * s2 - 4 * s + 1) * h * v0 + (-6 * s2 + 6 * s) * x1 + (3 * s2 - 2 * s) * h * v1);
    const next = Math.min(1, Math.max(0, s - (x - d) / Math.max(1e-12, dx)));
    if (Math.abs(next - s) < 1e-13) { s = next; break; }
    s = next;
  }
  return s;
}

/** Finish time for a race of `distance` metres (s). */
export function finishTime(r: Runner, distance: number): number {
  if (r.vmax <= 0) return Infinity;
  if (distance <= r.onset) return timeToCover(r, distance);
  let t = timeToCover(r, r.onset);
  let x = r.onset, v = sprintV(r, t);
  for (let i = 0; i < 1e7; i++) {
    const [x1, v1] = rk4(r, x, v, RK_DT);
    if (x1 >= distance) return t + RK_DT * hermiteCross(x, v, x1, v1, RK_DT, distance);
    x = x1;
    v = v1;
    t += RK_DT;
  }
  return Infinity;
}

/** After the line the runner eases off: speed decays with this time constant (s). */
export const EASE_OFF = 1.15;

/**
 * A runner's whole race, sampled for drawing: distance, speed and (when a
 * rate function is given) the gait's cycle count, every `step` seconds
 * from the gun to the finish, then a smooth ease-off after the line.
 */
export interface Profile {
  runner: Runner;
  distance: number;
  finish: number;
  step: number;
  x: Float64Array;
  v: Float64Array;
  /** Gait cycles completed (footfalls, wingbeats, hops…). */
  phase: Float64Array;
  /** Speed and cycle rate at the line, for the ease-off. */
  vFinish: number;
  rateFinish: number;
}

export function profileFor(r: Runner, distance: number, rate: (v: number) => number = () => 0, step = 0.02): Profile {
  const T = finishTime(r, distance);
  const finite = Number.isFinite(T) ? T : 0;
  const n = Math.max(2, Math.ceil(finite / step) + 1);
  const x = new Float64Array(n), v = new Float64Array(n), phase = new Float64Array(n);
  // Fine RK4 for the fatigued part, the closed form before it; the phase is integrated alongside (trapezoid on the fine grid).
  const sub = Math.max(1, Math.round(step / RK_DT));
  const h = step / sub;
  let cx = 0, cv = 0, cp = 0, t = 0;
  const tOnset = distance > r.onset ? timeToCover(r, r.onset) : Infinity;
  for (let i = 0; i < n; i++) {
    x[i] = cx;
    v[i] = cv;
    phase[i] = cp;
    for (let k = 0; k < sub; k++) {
      const t1 = t + h;
      let nx: number, nv: number;
      if (t1 <= tOnset) {
        nx = sprintX(r, t1);
        nv = sprintV(r, t1);
      } else {
        [nx, nv] = rk4(r, cx, cv, h);
      }
      cp += ((rate(cv) + rate(nv)) / 2) * h;
      cx = nx;
      cv = nv;
      t = t1;
    }
  }
  const vFinish = Number.isFinite(T) ? stateFromSamples({ x, v, step, n }, finite).v : 0;
  return { runner: r, distance, finish: T, step, x, v, phase, vFinish, rateFinish: rate(vFinish) };
}

function stateFromSamples(s: { x: Float64Array; v: Float64Array; step: number; n: number }, t: number): { x: number; v: number } {
  const f = t / s.step;
  const i = Math.min(s.n - 2, Math.max(0, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i));
  const h = s.step;
  const x0 = s.x[i], x1 = s.x[i + 1], v0 = s.v[i], v1 = s.v[i + 1];
  const u2 = u * u, u3 = u2 * u;
  const x = (2 * u3 - 3 * u2 + 1) * x0 + (u3 - 2 * u2 + u) * h * v0 + (-2 * u3 + 3 * u2) * x1 + (u3 - u2) * h * v1;
  return { x, v: v0 + (v1 - v0) * u };
}

export interface MotionState {
  /** Race distance covered (m). */
  x: number;
  /** Speed (m/s). */
  v: number;
  /** Acceleration (m/s²). */
  a: number;
  /** Gait cycles completed. */
  phase: number;
  finished: boolean;
}

/** Where a runner is at race time t (s after the gun); before the gun it waits on the line. */
export function motionAt(p: Profile, t: number): MotionState {
  if (t <= 0 || !(p.runner.vmax > 0)) return { x: 0, v: 0, a: 0, phase: 0, finished: false };
  const T = p.finish;
  if (Number.isFinite(T) && t >= T) {
    // Ease off after the line: v = vT·e^(−s/k).
    const s = t - T;
    const e = Math.exp(-s / EASE_OFF);
    const v = p.vFinish * e;
    const lastPhase = phaseAt(p, T);
    return { x: p.distance + p.vFinish * EASE_OFF * (1 - e), v, a: -v / EASE_OFF, phase: lastPhase + p.rateFinish * EASE_OFF * (1 - e), finished: true };
  }
  const n = p.x.length;
  const { x, v } = stateFromSamples({ x: p.x, v: p.v, step: p.step, n }, t);
  const a = (ceilingAt(p.runner, x) - v) / p.runner.tau;
  return { x, v, a, phase: phaseAt(p, t), finished: false };
}

function phaseAt(p: Profile, t: number): number {
  const f = t / p.step;
  const n = p.phase.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i));
  return p.phase[i] + (p.phase[i + 1] - p.phase[i]) * u;
}
