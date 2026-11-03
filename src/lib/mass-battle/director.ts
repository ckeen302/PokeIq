/**
 * The cinematic director: cuts the battle like an epic battle simulator's
 * trailer. Pure (no three.js): it reads a summary of the battlefield each
 * frame and returns a camera pose and a time scale. Shots are hard cuts;
 * within a shot the camera moves on its own (a drone sweep, a dolly, a
 * crane, an orbit) while it keeps the action framed.
 *
 * - Establishing: high and wide, a slow drone sweep over both armies.
 * - Charge: at ground level in front of the charging army, the horde
 *   running at the camera; then tracking alongside it.
 * - Impact: the moment the front lines meet, low and wide, in slow motion.
 * - Clash: over the thick of the fighting, a slow crane round it.
 * - Boss: over the lone giant's shoulder at the horde, or low, looking up.
 * - Slow motion: a huge hit (a critical hit on the boss, a crowd knocked
 *   out at once, the boss going down): a cut in close, at a third of the
 *   speed, with a punch.
 * - Last stand: an aerial circle over the last few of a side.
 * - Finale: the final blow in slow motion, then a rising orbit over the
 *   winners.
 *
 * Tall frames (videos, phones) get their own framing: armies stacked
 * along the frame rather than side by side.
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
  /** Mean speed of its standing units (m/s), when known. */
  speed?: number;
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
  kind: "crit" | "multi" | "ko-boss" | "big" | "final";
  x: number;
  z: number;
  h: number;
  /** Strength (for the shake). */
  power: number;
}

export type ShotName = "establish" | "charge" | "track" | "impact" | "clash" | "boss" | "hero" | "slowmo" | "aerial" | "finale";

const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
const dampAngle = (cur: number, target: number, rate: number, dt: number) => {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return target - d * Math.exp(-rate * dt);
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A pose from a camera position and the point it looks at. */
export function poseAt(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, fov: number): Pose {
  const dx = cx - tx, dy = cy - ty, dz = cz - tz;
  const flat = Math.hypot(dx, dz);
  const dist = Math.max(0.5, Math.hypot(flat, dy));
  return { tx, ty, tz, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.max(1e-3, flat)), dist, fov, shake: 0 };
}

/** Real seconds each shot holds before the director looks for the next. */
const HOLD: Record<ShotName, number> = { establish: 99, charge: 2.6, track: 2.4, impact: 1.6, clash: 4.2, boss: 3.6, hero: 3, slowmo: 1.5, aerial: 3.6, finale: 99 };

export class Director {
  shot: ShotName = "establish";
  /** Battle-time scale the director wants (slow motion < 1). */
  timeScale = 1;
  /** Slow motion on big moments (the viewer can turn it off). */
  allowSlow = true;
  pose: Pose = { tx: 0, ty: 1, tz: 0, yaw: 0.7, pitch: 0.55, dist: 80, fov: 40, shake: 0 };
  /** Cuts so far (a new shot each). */
  cuts = 0;
  onCut: ((shot: ShotName) => void) | null = null;
  private shotStart = 0;
  private real = 0;
  private slowCooldown = 0;
  private cue: Cue | null = null;
  private shakeLevel = 0;
  private lastStandDone = false;
  private contact = false;
  private impactDone = false;
  private chargeDone = false;
  private finaleAt = -1;
  private orbit = 0.7;
  /** Side of the line the shot is taken from (alternates, so cuts don't feel samey). */
  private flip = 1;
  private bossShots = 0;
  /** Where the latest heavy action was (follow-the-action). */
  private hot: { x: number; z: number; h: number; at: number } | null = null;
  private jump = true;
  /** Where the latest knockout was: the final blow, when the battle ends. */
  private finalCue: Cue | null = null;
  /** The side charging in the charge and tracking shots (the bigger army: the horde), fixed for the shot. */
  private lead: 0 | 1 = 0;

  /** Puts the camera straight on the establishing shot (no glide from wherever it was). */
  reset(f: FieldSummary) {
    this.shot = "establish";
    this.real = 0;
    this.shotStart = 0;
    this.slowCooldown = 0;
    this.timeScale = 1;
    this.lastStandDone = false;
    this.contact = false;
    this.impactDone = false;
    this.chargeDone = false;
    this.finaleAt = -1;
    this.cue = null;
    this.finalCue = null;
    this.hot = null;
    this.bossShots = 0;
    this.cuts = 0;
    this.flip = 1;
    this.pose = this.target(f, 0);
    this.jump = false;
  }

  /** A moment worth a cut (the director decides whether to take it). */
  offer(c: Cue) {
    if (c.kind === "final") {
      this.finalCue = c;
      return;
    }
    this.shakeLevel = Math.max(this.shakeLevel, Math.min(1.2, c.power));
    if (c.kind === "big" || c.kind === "multi") this.hot = { x: c.x, z: c.z, h: c.h, at: this.real };
    if (this.shot === "finale" || this.shot === "establish") return;
    if (c.kind === "big") return;
    if (this.real < this.slowCooldown && c.kind !== "ko-boss") return;
    this.cue = c;
    this.cut("slowmo");
    this.slowCooldown = this.real + 5.5;
  }

  private cut(s: ShotName, f?: FieldSummary) {
    if (f && (s === "charge" || s === "track")) {
      const [a, b] = f.armies;
      this.lead = b.alive > a.alive * 1.2 ? 1 : a.alive > b.alive * 1.2 ? 0 : (b.speed ?? 0) > (a.speed ?? 0) * 1.2 ? 1 : 0;
    }
    if (s !== this.shot || s === "slowmo") {
      this.cuts++;
      this.flip = -this.flip;
      this.jump = true;
      this.onCut?.(s);
    }
    this.shot = s;
    this.shotStart = this.real;
  }

  /** Advances by `dt` real seconds; returns the pose to draw. */
  update(f: FieldSummary, dt: number): Pose {
    this.real += dt;
    this.orbit += dt * 0.06;
    const [a, b] = f.armies;
    const gap = Math.hypot(a.fx - b.fx, a.fz - b.fz);
    const meet = Math.max(4, (a.h + b.h) * 1.2);
    if (f.phase === "battle" && gap < meet) this.contact = true;
    const since = this.real - this.shotStart;
    // Which shot.
    if (f.phase === "deploy") {
      if (this.shot !== "establish") this.cut("establish");
    } else if (f.phase === "ended") {
      if (this.shot !== "finale") {
        this.cut("finale");
        this.finaleAt = this.real;
      }
    } else if (this.shot === "slowmo") {
      if (since > HOLD.slowmo) this.next(f);
    } else if (this.shot === "establish") {
      this.cut(this.contact ? "impact" : "charge", f);
    } else if (!this.impactDone && this.contact && (this.shot === "charge" || this.shot === "track")) {
      this.impactDone = true;
      this.cut("impact");
    } else {
      const weakest = Math.min(a.alive / Math.max(1, a.start), b.alive / Math.max(1, b.start));
      const few = Math.min(a.alive, b.alive);
      const big = Math.max(a.start, b.start) >= 10;
      if (!this.lastStandDone && big && this.contact && (weakest < 0.15 || (few <= 6 && Math.min(a.start, b.start) > 6)) && since > 1) {
        this.lastStandDone = true;
        this.cut("aerial");
      } else if (since > HOLD[this.shot]) {
        this.next(f);
      }
    }
    // Time: slow motion for the impact, big moments and the final blow.
    const s = this.real - this.shotStart;
    let ts = 1;
    if (this.shot === "slowmo") ts = s < 1.1 ? 0.3 : 0.3 + (s - 1.1) * 1.6;
    else if (this.shot === "impact") ts = s < 0.9 ? 0.38 : Math.min(1, 0.38 + (s - 0.9) * 1.2);
    else if (this.shot === "finale" && this.real - this.finaleAt < 1.7) ts = 0.3;
    this.timeScale = this.allowSlow ? clamp(ts, 0.25, 1) : 1;
    const want = this.target(f, s);
    if (this.jump) {
      this.pose = { ...want };
      this.jump = false;
    } else {
      // Within a shot the rig glides (fast enough to keep the action framed, slow enough to feel like a camera operator).
      const r = this.shot === "establish" ? 1.6 : this.shot === "charge" || this.shot === "track" ? 3.2 : 2.4;
      const p = this.pose;
      p.tx = damp(p.tx, want.tx, r * 1.3, dt);
      p.ty = damp(p.ty, want.ty, r * 1.3, dt);
      p.tz = damp(p.tz, want.tz, r * 1.3, dt);
      p.yaw = dampAngle(p.yaw, want.yaw, r, dt);
      p.pitch = damp(p.pitch, want.pitch, r, dt);
      p.dist = Math.exp(damp(Math.log(p.dist), Math.log(want.dist), r, dt));
      p.fov = damp(p.fov, want.fov, r, dt);
    }
    this.shakeLevel = damp(this.shakeLevel, 0, 3.5, dt);
    this.pose.shake = this.shakeLevel * Math.min(1, this.pose.dist * 0.01);
    return this.pose;
  }

  /** The next shot in the melee. */
  private next(f: FieldSummary) {
    const [a, b] = f.armies;
    if (!this.contact) {
      this.cut(this.shot === "charge" ? "track" : "charge", f);
      return;
    }
    const options: ShotName[] = [];
    if (f.boss) options.push(this.bossShots % 2 === 0 ? "boss" : "hero");
    options.push("clash");
    if (Math.max(a.alive, b.alive) > 30) options.push("aerial");
    // Avoid repeating the shot we're on.
    const pick = options.find((o) => o !== this.shot) ?? options[0];
    if (pick === "boss" || pick === "hero") this.bossShots++;
    this.cut(pick);
  }

  private followPose: Pose | null = null;
  private followAt = 0;

  /**
   * The "follow the boss" camera: over the boss's shoulder at what's coming for it, gliding with it, no cuts and no
   * slow motion (with no boss, it rides along the bigger army's front).
   */
  follow(f: FieldSummary, dt: number): Pose {
    this.followAt += dt;
    this.orbit += dt * 0.06;
    const [a, b] = f.armies;
    if (!f.boss) this.lead = a.alive >= b.alive ? 0 : 1;
    const want = this.target(f, this.followAt, f.boss ? "boss" : "track");
    if (!this.followPose) this.followPose = { ...want };
    const p = this.followPose;
    const r = 2.2;
    p.tx = damp(p.tx, want.tx, r * 1.3, dt);
    p.ty = damp(p.ty, want.ty, r * 1.3, dt);
    p.tz = damp(p.tz, want.tz, r * 1.3, dt);
    p.yaw = dampAngle(p.yaw, want.yaw, r, dt);
    p.pitch = damp(p.pitch, want.pitch, r, dt);
    p.dist = Math.exp(damp(Math.log(p.dist), Math.log(want.dist), r, dt));
    p.fov = damp(p.fov, want.fov, r, dt);
    p.shake = 0;
    return p;
  }

  /** Starts the follow camera from a pose (no jump when switching to it). */
  startFollow(from: Pose) {
    this.followPose = { ...from };
    this.followAt = 0;
  }

  /** The pose each shot wants, `s` real seconds into it. */
  private target(f: FieldSummary, s: number, shot: ShotName = this.shot): Pose {
    const [a, b] = f.armies;
    const tall = f.aspect < 0.9;
    const fov = tall ? 50 : 36;
    const aspect = Math.max(0.3, f.aspect);
    // How far back to stand to fit a width w (m) across the frame.
    const fitW = (w: number, fv = fov) => w / 2 / (Math.tan((fv * Math.PI) / 360) * Math.min(aspect, 1.9));
    const fitH = (h: number, fv = fov) => h / 2 / Math.tan((fv * Math.PI) / 360);
    const S = Math.max(4, Math.hypot(b.cx - a.cx, b.cz - a.cz));
    const ux = (b.cx - a.cx) / S, uz = (b.cz - a.cz) / S;
    // Perpendicular to the line of battle.
    const px = -uz * this.flip, pz = ux * this.flip;
    const mx = (a.fx + b.fx) / 2, mz = (a.fz + b.fz) / 2;
    const h = Math.max(0.3, (a.h + b.h) / 2);
    const big = Math.max(a.h, b.h);
    switch (shot) {
      case "establish": {
        const span = Math.max(16, S + a.extent + b.extent);
        const cx = (a.cx + b.cx) / 2, cz = (a.cz + b.cz) / 2;
        if (tall) {
          // From behind and above the first army, down the line of battle: the far army just under the middle of
          // the frame, the near one below it (titles over the top, controls along the bottom stay clear).
          const back = S * 1.05 + a.extent + big * 2;
          const gapWanted = (fov * Math.PI) / 180 * 0.27;
          // The angle between the armies grows with the camera's height up to a peak, then shrinks again as the view
          // turns to look straight down: the lowest height that opens the gap wanted, or the peak when the armies are
          // too far apart for it (a big battle). Never higher, where the armies shrink to lines.
          const gap = (H: number) => Math.atan2(H - a.h * 0.5, back) - Math.atan2(H - b.h * 0.5, back + S);
          let lo = 1, hi = back * 4;
          for (let k = 0; k < 40; k++) {
            const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
            if (gap(m1) < gap(m2)) lo = m1;
            else hi = m2;
          }
          let H = (lo + hi) / 2;
          if (gap(H) > gapWanted) {
            lo = 1;
            hi = H;
            for (let k = 0; k < 30; k++) {
              const m = (lo + hi) / 2;
              if (gap(m) < gapWanted) lo = m;
              else hi = m;
            }
            H = (lo + hi) / 2;
          }
          // The far army a little under the middle, clear of the video's title card above it.
          const pitch = Math.atan2(H - b.h * 0.5, back + S) - (fov * Math.PI) / 180 * 0.05;
          const side = Math.sin(s * 0.12) * S * 0.08;
          const camX = a.cx - ux * back + px * side, camZ = a.cz - uz * back + pz * side;
          const D = back + S;
          return { tx: camX + ux * D, ty: H - D * Math.tan(pitch), tz: camZ + uz * D, yaw: Math.atan2(-ux, -uz), pitch, dist: Math.hypot(D, D * Math.tan(pitch)), fov, shake: 0 };
        }
        // A drone shot from behind the lone boss (or the bigger army), three-quarters on, the enemy across the field,
        // sweeping slowly; back far enough for both armies (and their width) to stay in frame wherever the sweep is.
        const nearSide = f.boss ? f.boss.side : a.alive >= b.alive ? 0 : 1;
        const near = nearSide === 0 ? a : b, far = nearSide === 0 ? b : a;
        const nx = near.cx - far.cx, nz = near.cz - far.cz;
        const nl = Math.hypot(nx, nz) || 1;
        const off = (0.62 + 0.12 * Math.sin(this.orbit * 0.8 + s * 0.05)) * this.flip;
        const dirX = (nx / nl) * Math.cos(off) - (nz / nl) * Math.sin(off), dirZ = (nx / nl) * Math.sin(off) + (nz / nl) * Math.cos(off);
        const yaw = Math.atan2(dirX, dirZ);
        const pitch = 0.28;
        const half = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
        const tx0 = cx * 0.85 + far.cx * 0.15, tz0 = cz * 0.85 + far.cz * 0.15;
        const halfV = (fov * Math.PI) / 360;
        const ty0 = big * 0.5;
        const fits = (dist: number) => {
          const cp = Math.cos(pitch);
          const camX = tx0 + Math.sin(yaw) * cp * dist, camZ = tz0 + Math.cos(yaw) * cp * dist, camY = ty0 + Math.sin(pitch) * dist;
          const fwd = Math.atan2(tx0 - camX, tz0 - camZ);
          const rx = Math.cos(yaw), rz = -Math.sin(yaw);
          for (const army of [a, b]) {
            for (const e of [-1, 0, 1]) {
              const x = army.cx + rx * army.extent * e, z = army.cz + rz * army.extent * e;
              let d = Math.atan2(x - camX, z - camZ) - fwd;
              d = Math.atan2(Math.sin(d), Math.cos(d));
              if (Math.abs(d) > half * (e === 0 ? 0.84 : 0.96)) return false;
              const flat = Math.hypot(x - camX, z - camZ);
              // Never right on top of the near army; low enough in the frame to clear the titles, high enough to clear the controls.
              if (flat < army.h * 4 + 4) return false;
              const v = Math.atan2(army.h * 0.5 - camY, flat) + pitch;
              if (v > halfV * 0.2 || v < -halfV * 0.72) return false;
            }
          }
          return true;
        };
        let dist = Math.max(10, span * 0.4);
        for (let k = 0; k < 40 && !fits(dist); k++) dist *= 1.06;
        return { tx: tx0, ty: ty0, tz: tz0, yaw, pitch, dist, fov, shake: 0 };
      }
      case "charge": {
        // At ground level in front of the charging army, the horde coming at the camera (it backs away as they come).
        const lead = this.lead === 1 ? b : a;
        const other = lead === a ? b : a;
        const vx = other.cx - lead.cx, vz = other.cz - lead.cz;
        const vl = Math.hypot(vx, vz) || 1;
        const dx = vx / vl, dz = vz / vl;
        const d = Math.max(4.5, lead.h * 6.5 + Math.min(lead.extent, 30) * 0.14) * (tall ? 1.25 : 1);
        const camX = lead.fx + dx * d + -dz * this.flip * d * 0.25, camZ = lead.fz + dz * d + dx * this.flip * d * 0.25;
        return poseAt(camX, Math.max(0.7, lead.h * 1.0), camZ, lead.fx - dx * lead.extent * 0.25, lead.h * 0.65, lead.fz - dz * lead.extent * 0.25, fov + 4);
      }
      case "track": {
        // Tracking alongside the charge, low, the enemy ahead.
        const lead = this.lead === 1 ? b : a;
        const other = lead === a ? b : a;
        const vx = other.cx - lead.cx, vz = other.cz - lead.cz;
        const vl = Math.hypot(vx, vz) || 1;
        const dx = vx / vl, dz = vz / vl;
        const off = Math.max(5, lead.h * 6 + Math.min(lead.extent, 40) * 0.18);
        const sx = -dz * this.flip, sz = dx * this.flip;
        const tx = lead.fx - dx * lead.h, tz = lead.fz - dz * lead.h;
        return poseAt(tx + sx * off - dx * off * 0.35, Math.max(0.6, lead.h * 1.1 + off * 0.12), tz + sz * off - dz * off * 0.35, tx + dx * off * 0.4, lead.h * 0.6, tz + dz * off * 0.4, fov);
      }
      case "impact": {
        // The fronts meeting, low and wide from the side (from behind one army in a tall frame), drifting in.
        const w = Math.max(10, Math.min(a.extent, b.extent) * 1.4 + 6);
        if (tall) {
          const back = fitH(w * 0.9) * 0.7 + big * 3;
          return poseAt(mx - ux * back + px * back * 0.15, Math.max(1, big * 1.4 + back * 0.18), mz - uz * back + pz * back * 0.15, mx + ux * 2, h * 0.5, mz + uz * 2, fov);
        }
        const d = Math.max(fitW(w) * 0.8, 6) * (1 - Math.min(0.2, s * 0.08));
        return poseAt(mx + px * d - ux * d * 0.15, Math.max(0.6, h * 1.2 + d * 0.1), mz + pz * d - uz * d * 0.15, mx, h * 0.55, mz, fov);
      }
      case "clash": {
        // A crane round the thick of it (the latest heavy action, or where the fronts meet).
        const hot = this.hot && this.real - this.hot.at < 6 ? this.hot : null;
        const cx = hot ? hot.x * 0.6 + mx * 0.4 : mx, cz = hot ? hot.z * 0.6 + mz * 0.4 : mz;
        const local = Math.max(8, Math.min(a.extent, b.extent) * 0.7 + 6);
        const d = (tall ? fitH(local) * 0.9 : fitW(local)) + h * 4;
        return { tx: cx, ty: h * 0.5, tz: cz, yaw: Math.atan2(px, pz) + 0.5 * this.flip + s * 0.09 * this.flip, pitch: 0.36 + Math.min(0.15, s * 0.03), dist: d, fov, shake: 0 };
      }
      case "boss": {
        // Over the boss's shoulder at the horde coming for it.
        const bo = f.boss ?? { x: mx, z: mz, h, side: 1 as const };
        const foe = bo.side === 0 ? b : a;
        const vx = foe.cx - bo.x, vz = foe.cz - bo.z;
        const vl = Math.hypot(vx, vz) || 1;
        const dx = vx / vl, dz = vz / vl;
        const sx = -dz * this.flip, sz = dx * this.flip;
        const back = bo.h * (tall ? 2.4 : 2) + 2;
        const camX = bo.x - dx * back + sx * bo.h * 0.9 + sx * s * 0.25, camZ = bo.z - dz * back + sz * bo.h * 0.9 + sz * s * 0.25;
        return poseAt(camX, bo.h * 1.05 + 0.5, camZ, bo.x + dx * Math.max(4, bo.h * 2.5), bo.h * 0.35, bo.z + dz * Math.max(4, bo.h * 2.5), fov);
      }
      case "hero": {
        // Low in front of the boss, looking up at it, circling slowly.
        const bo = f.boss ?? { x: mx, z: mz, h, side: 1 as const };
        const foe = bo.side === 0 ? b : a;
        const vx = foe.cx - bo.x, vz = foe.cz - bo.z;
        const vl = Math.hypot(vx, vz) || 1;
        const base = Math.atan2(vx / vl, vz / vl) + 0.6 * this.flip;
        const ang = base + s * 0.12 * this.flip;
        const d = bo.h * 2.4 + 2.5;
        return poseAt(bo.x + Math.sin(ang) * d, Math.max(0.3, bo.h * 0.12), bo.z + Math.cos(ang) * d, bo.x, bo.h * 0.62, bo.z, fov + 4);
      }
      case "slowmo": {
        const c = this.cue ?? { x: mx, z: mz, h, power: 0, kind: "crit" as const };
        // A crowd knocked out at once is seen from above the crowd (close in, the bodies round it would block the view);
        // a single huge hit is seen close and low.
        const wide = c.kind === "multi";
        const d = (wide ? Math.max(8, c.h * 3 + 7) : Math.max(3.2, c.h * 2.4 + 2.5)) * (tall ? 1.15 : 1);
        const ang = Math.atan2(px, pz) + 0.5 * this.flip + s * 0.22 * this.flip;
        return { tx: c.x, ty: c.h * 0.5, tz: c.z, yaw: ang, pitch: (wide ? 0.5 : 0.12) + s * 0.02, dist: d * (1 - Math.min(0.15, s * 0.1)), fov: fov - 2, shake: 0 };
      }
      case "aerial": {
        const loser = a.alive / Math.max(1, a.start) < b.alive / Math.max(1, b.start) ? a : b;
        const r = Math.max(10, loser.extent * 1.6 + 8);
        return { tx: loser.cx, ty: 0, tz: loser.cz, yaw: this.orbit * 1.5 + s * 0.12, pitch: 1.05, dist: (tall ? fitH(r * 1.2) : fitW(r * 1.4)) + 6, fov, shake: 0 };
      }
      case "finale": {
        const win = a.alive >= b.alive ? a : b;
        const since = this.real - this.finaleAt;
        const c = since < 1.7 ? this.finalCue ?? this.cue : null;
        if (c) {
          // The final blow, close and slow.
          const d = Math.max(3.5, c.h * 2.6 + 3);
          return { tx: c.x, ty: c.h * 0.5, tz: c.z, yaw: Math.atan2(px, pz) + 0.4 + since * 0.15, pitch: 0.14, dist: d, fov: fov - 2, shake: 0 };
        }
        const bo = f.boss;
        const tx = bo && bo.side === (win === a ? 0 : 1) ? bo.x : win.cx, tz = bo && bo.side === (win === a ? 0 : 1) ? bo.z : win.cz;
        const r = Math.max(6, win.extent * 1.2 + win.h * 3 + 4);
        const d = (tall ? fitH(r) * 0.9 : fitW(r)) + win.h * 2;
        const k = Math.min(1, Math.max(0, since - 1.7) / 6);
        return { tx, ty: win.h * 0.5, tz, yaw: Math.atan2(px, pz) + 0.3 + since * 0.08, pitch: 0.18 + k * 0.35, dist: d * (0.75 + k * 0.5), fov, shake: 0 };
      }
    }
  }
}
