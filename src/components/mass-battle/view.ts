import { EV, EVENT_INTS, TICK_HZ } from "@/lib/mass-battle/engine";
import type { FieldSummary } from "@/lib/mass-battle/director";
import type { SimEnd, SimFrame, SimReady } from "./protocol";

/**
 * The page's copy of the battle as it is drawn: the frames the worker sent
 * (a few ticks ahead), positions interpolated between ticks at the
 * playback clock, and each unit's last hit, attack and faint for the
 * figures' animation. Events are handed on (effects, sound, kill feed,
 * the director) as the clock passes them.
 */

export interface Hit {
  /** Battle time (s). */
  t: number;
  actor: number;
  target: number;
  slot: number;
  damage: number;
  flags: number;
  action: number;
  /** Positions at the time. */
  ax: number;
  az: number;
  tx: number;
  tz: number;
}

export class BattleView {
  readonly ready: SimReady;
  readonly n: number;
  readonly sp: Uint16Array;
  readonly side: Uint8Array;
  readonly draw: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly fx: Float32Array;
  readonly fz: Float32Array;
  readonly hitAt: Float32Array;
  /** How hard the last hit was (its damage over the unit's max HP, 0..1). */
  readonly hitPower: Float32Array;
  readonly attackAt: Float32Array;
  readonly faintAt: Float32Array;
  readonly hp: Uint16Array;
  /** The playback clock (battle seconds). */
  t = 0;
  left: [number, number];
  end: SimEnd | null = null;
  /** Units drawn vs fighting (above the quality's cap only a share is drawn). */
  readonly drawn: number;
  private frames: SimFrame[] = [];
  private eventsDone = 0;
  private spent: SimFrame[] = [];
  onHit: ((h: Hit) => void) | null = null;

  constructor(ready: SimReady, cap: number) {
    this.ready = ready;
    const n = (this.n = ready.n);
    this.sp = ready.sp;
    this.side = ready.side;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.fx = new Float32Array(n).fill(NaN);
    this.fz = new Float32Array(n).fill(NaN);
    this.hitAt = new Float32Array(n).fill(-1);
    this.hitPower = new Float32Array(n);
    this.attackAt = new Float32Array(n).fill(-1);
    this.faintAt = new Float32Array(n).fill(-1);
    this.hp = new Uint16Array(n);
    this.left = [...ready.frame.left] as [number, number];
    this.draw = drawMask(ready, cap);
    this.drawn = this.draw.reduce((a, b) => a + b, 0);
    this.frames.push(ready.frame);
    this.interpolate();
  }

  /** Battle seconds of the newest frame. */
  get head(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].tick / TICK_HZ : 0;
  }

  get ended(): boolean {
    return !!this.end && this.t >= this.head - 1e-6;
  }

  push(frames: SimFrame[], end?: SimEnd) {
    for (const f of frames) this.frames.push(f);
    if (end) this.end = end;
  }

  /** Frames already drawn past (their buffers can go back to the worker). */
  takeSpent(): SimFrame[] {
    const s = this.spent;
    this.spent = [];
    return s;
  }

  /** Moves the clock on by `dt` battle seconds (never past the newest frame); fires the events passed. */
  advance(dt: number) {
    this.t = Math.min(this.head, this.t + Math.max(0, dt));
    // Events of tick k happen during the step that ends at k: fire them once the clock reaches k − ½ tick.
    while (this.frames.length) {
      const f = this.frames[this.eventsDone] ?? null;
      if (!f) break;
      const ft = (f.tick - 0.5) / TICK_HZ;
      if (ft > this.t) break;
      this.fire(f);
      this.eventsDone++;
    }
    // Keep the frame before the clock for interpolation; hand older ones back.
    while (this.frames.length > 2 && this.frames[1].tick / TICK_HZ <= this.t && this.eventsDone > 1) {
      this.spent.push(this.frames.shift()!);
      this.eventsDone--;
    }
    this.interpolate();
  }

  private fire(f: SimFrame) {
    const ev = f.events;
    const t = (f.tick - 0.5) / TICK_HZ;
    for (let k = 0; k < ev.length; k += EVENT_INTS) {
      const actor = ev[k], target = ev[k + 1], flags = ev[k + 4];
      if (!(flags & EV.RECOIL)) this.attackAt[actor] = t;
      if (target !== actor && !(flags & (EV.MISS | EV.IMMUNE))) {
        this.hitAt[target] = t;
        this.hitPower[target] = Math.min(1, ev[k + 3] / Math.max(1, this.ready.maxHp[this.sp[target]]));
      }
      if (flags & EV.KO) this.faintAt[target] = t;
      this.onHit?.({ t, actor, target, slot: ev[k + 2], damage: ev[k + 3], flags, action: ev[k + 5], ax: f.pos[actor * 2], az: f.pos[actor * 2 + 1], tx: f.pos[target * 2], tz: f.pos[target * 2 + 1] });
    }
    for (let i = 0; i < this.n; i++) this.hp[i] = f.hp[i];
    this.left = [...f.left] as [number, number];
  }

  private interpolate() {
    const fr = this.frames;
    if (!fr.length) return;
    let a = fr[0], b = fr[0];
    for (let k = 0; k < fr.length; k++) {
      if (fr[k].tick / TICK_HZ <= this.t) a = fr[k];
      if (fr[k].tick / TICK_HZ >= this.t) { b = fr[k]; break; }
      b = fr[k];
    }
    const ta = a.tick / TICK_HZ, tb = b.tick / TICK_HZ;
    const k = tb > ta ? Math.min(1, Math.max(0, (this.t - ta) / (tb - ta))) : 1;
    const pa = a.pos, pb = b.pos;
    // (A fainted unit stays where it fell: the simulation stops moving it.)
    for (let i = 0; i < this.n; i++) {
      this.x[i] = pa[i * 2] + (pb[i * 2] - pa[i * 2]) * k;
      this.z[i] = pa[i * 2 + 1] + (pb[i * 2 + 1] - pa[i * 2 + 1]) * k;
      const t = b.target[i];
      if (t >= 0) {
        this.fx[i] = pb[t * 2];
        this.fz[i] = pb[t * 2 + 1];
      }
    }
  }
}

/** Which units are drawn: all of them under the cap; above it a representative share of each species (bosses always). */
export function drawMask(ready: Pick<SimReady, "n" | "sp" | "species">, cap: number): Uint8Array {
  const n = ready.n;
  const out = new Uint8Array(n);
  if (n <= cap) return out.fill(1);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) counts.set(ready.sp[i], (counts.get(ready.sp[i]) ?? 0) + 1);
  let fixed = 0, rest = 0;
  for (const c of counts.values()) {
    if (c <= 3) fixed += c;
    else rest += c;
  }
  const share = Math.max(0, cap - fixed) / Math.max(1, rest);
  const seen = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const s = ready.sp[i];
    const c = counts.get(s)!;
    if (c <= 3) { out[i] = 1; continue; }
    const k = seen.get(s) ?? 0;
    seen.set(s, k + 1);
    // Evenly spaced through the species (formations are laid out in order, so the share spreads over the army).
    out[i] = Math.floor((k + 1) * share) > Math.floor(k * share) ? 1 : 0;
  }
  return out;
}

/** What the director needs to know about the battlefield this frame. */
export function summarize(view: BattleView, heights: number[], phase: FieldSummary["phase"], aspect: number): FieldSummary {
  const n = view.n;
  const sx = [0, 0], sz = [0, 0], cnt = [0, 0], hs = [0, 0];
  for (let i = 0; i < n; i++) {
    const s = view.side[i];
    const standing = view.faintAt[i] < 0 || view.t - view.faintAt[i] < 0.5;
    if (!standing) continue;
    sx[s] += view.x[i];
    sz[s] += view.z[i];
    hs[s] += heights[view.sp[i]];
    cnt[s]++;
  }
  const armies = [0, 1].map((s) => {
    const c = Math.max(1, cnt[s]);
    return { alive: view.left[s], start: view.ready.start[s], cx: sx[s] / c, cz: sz[s] / c, extent: 0, fx: sx[s] / c, fz: sz[s] / c, h: hs[s] / c || 1 };
  }) as [FieldSummary["armies"][0], FieldSummary["armies"][1]];
  const front = [Infinity, Infinity];
  for (let i = 0; i < n; i++) {
    const s = view.side[i];
    if (view.faintAt[i] >= 0) continue;
    const a = armies[s], o = armies[1 - s];
    const r = Math.hypot(view.x[i] - a.cx, view.z[i] - a.cz) + heights[view.sp[i]] * 0.3;
    if (r > a.extent) a.extent = r;
    const d = Math.hypot(view.x[i] - o.cx, view.z[i] - o.cz);
    if (d < front[s]) {
      front[s] = d;
      a.fx = view.x[i];
      a.fz = view.z[i];
    }
  }
  // A boss: a side of three or fewer against a bigger army.
  let boss: FieldSummary["boss"] = null;
  for (const s of [0, 1] as const) {
    if (view.ready.start[s] <= 3 && view.ready.start[1 - s] >= 4) {
      let best = -1;
      for (let i = 0; i < n; i++) if (view.side[i] === s && (view.faintAt[i] < 0 || view.t - view.faintAt[i] < 1.5) && (best < 0 || heights[view.sp[i]] > heights[view.sp[best]])) best = i;
      if (best >= 0) boss = { x: view.x[best], z: view.z[best], h: heights[view.sp[best]], side: s };
    }
  }
  return { t: view.t, phase, armies, boss, arena: view.ready.arena, aspect };
}
