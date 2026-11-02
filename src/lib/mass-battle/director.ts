/**
 * The cinematic director: picks the camera's shot from what the battle is
 * doing, like a sports broadcast. Pure (no three.js): it reads a summary
 * of the battlefield each frame and returns a camera pose and a time scale.
 *
 * - Establishing: a drone sweep round the field while the armies line up.
 * - Charge: low behind the charging army, looking at the enemy.
 * - Clash: over the front line where the armies meet.
 * - Boss: following the lone giant (a side of three or fewer).
 * - Slow motion: a cut to a critical hit on the boss, a spread move that
 *   knocks out a crowd, or the boss going down, at a third of the speed.
 * - Last stand: an aerial circle over the last few of a side.
 * - Finale: the final blow in slow motion, then a slow orbit of the winners.
 *
 * Every part of the pose eases toward its target (frame-rate independent),
 * so the camera glides; slow-motion cuts jump.
 */

export interface Pose {
  tx: number;
  ty: number;
  tz: number;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
  shake: number;
}

export interface ArmySummary {
  /** Units standing. */
  alive: number;
  start: number;
  cx: number;
  cz: number;
  /** Radius round the centre holding the army (m). */
  extent: number;
  /** The unit nearest the enemy (its front), x and z. */
  fx: number;
  fz: number;
  /** Typical figure height (m). */
  h: number;
}

export interface FieldSummary {
  t: number;
  phase: "deploy" | "battle" | "ended";
  armies: [ArmySummary, ArmySummary];
  /** The boss, if one side is a few big units: its position and height. */
  boss: { x: number; z: number; h: number; side: 0 | 1 } | null;
  arena: number;
  /** Width / height of the frame (portrait for videos). */
  aspect: number;
}

export interface Cue {
  kind: "crit" | "multi" | "ko-boss" | "big";
  x: number;
  z: number;
  h: number;
  /** Strength (for the shake). */
  power: number;
}

export type ShotName = "establish" | "charge" | "clash" | "boss" | "slowmo" | "aerial" | "finale";

const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
const dampAngle = (cur: number, target: number, rate: number, dt: number) => {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return target - d * Math.exp(-rate * dt);
};

export class Director {
  shot: ShotName = "establish";
  /** Battle-time scale the director wants (slow motion < 1). */
  timeScale = 1;
  pose: Pose = { tx: 0, ty: 1, tz: 0, yaw: 0.7, pitch: 0.55, dist: 80, fov: 40, shake: 0 };
  private shotStart = 0;
  private real = 0;
  private slowUntil = -1;
  private slowCooldown = 0;
  private cue: Cue | null = null;
  private shakeLevel = 0;
  private lastStandDone = false;
  private contact = false;
  private finaleAt = -1;
  private orbit = 0.7;

  /** Puts the camera straight on the establishing shot (no glide from wherever it was). */
  reset(f: FieldSummary) {
    this.shot = "establish";
    this.real = 0;
    this.shotStart = 0;
    this.slowUntil = -1;
    this.timeScale = 1;
    this.lastStandDone = false;
    this.contact = false;
    this.finaleAt = -1;
    this.pose = this.target(f, 0);
  }

  /** A moment worth a slow-motion cut (the director decides whether to take it). */
  offer(c: Cue) {
    this.shakeLevel = Math.max(this.shakeLevel, Math.min(1.2, c.power));
    if (this.real < this.slowCooldown || this.shot === "finale") return;
    if (c.kind === "big") return;
    this.cue = c;
    this.cut("slowmo");
    this.slowUntil = this.real + 1.5;
    this.slowCooldown = this.real + 6;
  }

  private cut(s: ShotName) {
    this.shot = s;
    this.shotStart = this.real;
  }

  /** Advances by `dt` real seconds; returns the pose to draw. */
  update(f: FieldSummary, dt: number): Pose {
    this.real += dt;
    this.orbit += dt * 0.07;
    const [a, b] = f.armies;
    const gap = Math.hypot(a.fx - b.fx, a.fz - b.fz);
    if (f.phase === "battle" && gap < 6) this.contact = true;
    // Which shot.
    const since = this.real - this.shotStart;
    if (f.phase === "deploy") {
      if (this.shot !== "establish") this.cut("establish");
    } else if (f.phase === "ended") {
      if (this.shot !== "finale") {
        this.cut("finale");
        this.finaleAt = this.real;
      }
    } else if (this.shot === "slowmo") {
      if (this.real > this.slowUntil) this.cut(this.contact ? (f.boss ? "boss" : "clash") : "charge");
    } else {
      const weakest = Math.min(a.alive / Math.max(1, a.start), b.alive / Math.max(1, b.start));
      const few = Math.min(a.alive, b.alive);
      const big = Math.max(a.start, b.start) >= 10;
      if (!this.lastStandDone && big && this.contact && (weakest < 0.12 || (few <= 5 && Math.min(a.start, b.start) > 5))) {
        this.lastStandDone = true;
        this.cut("aerial");
      } else if (this.shot === "establish" || (this.shot === "charge" && this.contact)) {
        this.cut(this.contact ? (f.boss ? "boss" : "clash") : "charge");
      } else if (this.shot === "aerial" && since > 4) {
        this.cut(f.boss ? "boss" : "clash");
      } else if (this.shot === "boss" && since > 6) {
        this.cut("clash");
      } else if (this.shot === "clash" && since > 5 && f.boss) {
        this.cut("boss");
      }
    }
    // Time: slow motion for cuts and the final blow.
    if (this.shot === "slowmo") this.timeScale = 0.32;
    else if (this.shot === "finale" && this.real - this.finaleAt < 1.4) this.timeScale = 0.35;
    else this.timeScale = 1;
    const want = this.target(f, this.real - this.shotStart);
    // Ease toward the shot (cuts into slow motion jump).
    const jump = this.shot === "slowmo" && this.real - this.shotStart < dt * 1.5;
    if (jump) {
      this.pose = { ...want };
    } else {
      const r = this.shot === "establish" ? 2.2 : 2.6;
      const p = this.pose;
      p.tx = damp(p.tx, want.tx, r * 1.4, dt);
      p.ty = damp(p.ty, want.ty, r * 1.4, dt);
      p.tz = damp(p.tz, want.tz, r * 1.4, dt);
      p.yaw = dampAngle(p.yaw, want.yaw, r, dt);
      p.pitch = damp(p.pitch, want.pitch, r, dt);
      p.dist = Math.exp(damp(Math.log(p.dist), Math.log(want.dist), r, dt));
      p.fov = damp(p.fov, want.fov, r, dt);
    }
    this.shakeLevel = damp(this.shakeLevel, 0, 4, dt);
    this.pose.shake = this.shakeLevel * Math.min(1.2, this.pose.dist * 0.012);
    return this.pose;
  }

  /** The pose each shot wants. */
  private target(f: FieldSummary, s: number): Pose {
    const [a, b] = f.armies;
    const portrait = f.aspect < 0.9;
    const fov = portrait ? 52 : 38;
    const widen = portrait ? 1.35 : 1;
    const mx = (a.fx + b.fx) / 2, mz = (a.fz + b.fz) / 2;
    const h = Math.max(0.3, (a.h + b.h) / 2);
    // Side A charges along +x: the camera looks along the line of battle from the side, a little behind A.
    switch (this.shot) {
      case "establish": {
        // Both armies in view, low enough to feel the scale, the target a little above them so they sit low in the frame (titles go on top).
        const span = Math.max(a.extent + b.extent + Math.hypot(a.cx - b.cx, a.cz - b.cz), 16);
        const big = Math.max(a.h, b.h);
        return { tx: (a.cx + b.cx) / 2, ty: big * 0.9 + span * 0.06, tz: (a.cz + b.cz) / 2, yaw: 0.5 + this.orbit + s * 0.05, pitch: 0.3 - Math.min(0.08, s * 0.015), dist: span * 0.55 * widen + big * 2 + 6, fov, shake: 0 };
      }
      case "charge": {
        const dx = b.cx - a.cx, dz = b.cz - a.cz;
        const yaw = Math.atan2(-dx, -dz);
        const d = Math.max(6, a.extent * 0.55 + 4) * widen;
        return { tx: a.fx + Math.sign(dx || 1) * 3, ty: a.h * 0.9, tz: a.fz, yaw: yaw + 0.25 * Math.sin(s * 0.4), pitch: 0.14, dist: d, fov: fov + 6, shake: 0 };
      }
      case "clash": {
        const local = Math.max(10, Math.min(a.extent, b.extent) * 0.9 + 8);
        return { tx: mx, ty: h * 0.5, tz: mz, yaw: 0.9 + this.orbit * 1.4, pitch: 0.48, dist: local * widen + h * 4, fov, shake: 0 };
      }
      case "boss": {
        const bo = f.boss ?? { x: mx, z: mz, h, side: 1 };
        return { tx: bo.x, ty: bo.h * 0.55, tz: bo.z, yaw: 1.2 + this.orbit * 2 + s * 0.08, pitch: 0.24, dist: Math.max(6, bo.h * 4.2 + 4) * widen, fov, shake: 0 };
      }
      case "slowmo": {
        const c = this.cue ?? { x: mx, z: mz, h, power: 0, kind: "crit" as const };
        return { tx: c.x, ty: c.h * 0.5, tz: c.z, yaw: this.orbit * 3 + 0.6 + s * 0.35, pitch: 0.16, dist: Math.max(3.2, c.h * 2.6 + 2.5) * widen, fov: fov - 4, shake: 0 };
      }
      case "aerial": {
        const loser = a.alive / Math.max(1, a.start) < b.alive / Math.max(1, b.start) ? a : b;
        return { tx: loser.cx, ty: 0, tz: loser.cz, yaw: this.orbit * 2 + s * 0.15, pitch: 0.95, dist: (Math.max(10, loser.extent * 2.2) + 14) * widen, fov, shake: 0 };
      }
      case "finale": {
        const win = a.alive >= b.alive ? a : b;
        const d = Math.max(8, win.extent * 1.4 + win.h * 3 + 6) * widen;
        const close = this.real - this.finaleAt < 1.4;
        const bo = f.boss;
        const tx = close && bo ? bo.x : win.cx, tz = close && bo ? bo.z : win.cz;
        return { tx, ty: (close && bo ? bo.h : win.h) * 0.5, tz, yaw: this.orbit * 2 + s * 0.12, pitch: 0.3 + Math.min(0.25, s * 0.03), dist: close ? d * 0.6 : d + s * 1.5, fov, shake: 0 };
      }
    }
  }
}
