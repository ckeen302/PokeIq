/**
 * The lab's quality tiers, lightest (0) to richest (3), and the governor
 * that moves between them from measured frame times: a laptop that can't
 * hold ~45 fps steps down (pixel ratio, shadows, the floor's reflection,
 * depth of field, bloom, particles), one that runs well steps back up, never
 * past where it started. Phones start lighter.
 */

export type Tier = 0 | 1 | 2 | 3;

export interface TierSpec {
  /** Highest device pixel ratio drawn. */
  dpr: number;
  /** Key light's shadow map (0: no shadows). */
  shadow: number;
  /** Rim light casts too. */
  rimShadow: boolean;
  /** Floor reflection's resolution, a share of the frame's (0: none). */
  mirror: number;
  msaa: number;
  dof: boolean;
  dofSamples: 16 | 32;
  bloom: boolean;
  /** Type particles round the table. */
  particles: number;
  /** Dust in the air. */
  motes: number;
  /** Figures kept cached. */
  caps: { pod: number; hero: number };
  /** Pod figures' relief detail (mesh segments). */
  podSegments: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  0: { dpr: 1, shadow: 0, rimShadow: false, mirror: 0, msaa: 0, dof: false, dofSamples: 16, bloom: false, particles: 0, motes: 300, caps: { pod: 24, hero: 3 }, podSegments: 40 },
  1: { dpr: 1.25, shadow: 1024, rimShadow: false, mirror: 0.25, msaa: 2, dof: false, dofSamples: 16, bloom: true, particles: 90, motes: 700, caps: { pod: 28, hero: 4 }, podSegments: 48 },
  2: { dpr: 1.5, shadow: 1024, rimShadow: true, mirror: 0.34, msaa: 4, dof: true, dofSamples: 16, bloom: true, particles: 170, motes: 1100, caps: { pod: 36, hero: 5 }, podSegments: 56 },
  3: { dpr: 2, shadow: 2048, rimShadow: true, mirror: 0.5, msaa: 4, dof: true, dofSamples: 32, bloom: true, particles: 260, motes: 1400, caps: { pod: 40, hero: 6 }, podSegments: 64 },
};

/** Where a device starts: phones light, small laptops in the middle, the rest at the top. */
export function startTier(o: { phone: boolean; cores: number; memoryGb?: number }): Tier {
  if (o.phone) return o.memoryGb !== undefined && o.memoryGb <= 3 ? 0 : 1;
  if (o.cores <= 4 || (o.memoryGb !== undefined && o.memoryGb <= 4)) return 2;
  return 3;
}

/**
 * Watches frame times (seconds) and says when to change tier. Waits for the
 * scene to warm up (shader compiles, first figures), judges over windows of
 * a second and a half, and after a change waits again before judging.
 */
export class Governor {
  private acc = 0;
  private n = 0;
  private slow = 0;
  private fast = 0;
  private wait: number;
  /** How often each tier proved too slow: one that failed twice isn't tried again. */
  private failed: Record<number, number> = {};
  constructor(public tier: Tier, private ceiling: Tier, warmup = 2.5) {
    this.wait = warmup;
  }

  /** Feeds one frame's time; returns the new tier when it should change. */
  frame(dt: number): Tier | null {
    if (this.wait > 0) {
      this.wait -= dt;
      return null;
    }
    // A hitch (tab switch, a long task) isn't the frame rate.
    if (dt > 0.25) return null;
    this.acc += dt;
    this.n++;
    if (this.acc < 1.5) return null;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    if (avg > 1 / 42) {
      this.fast = 0;
      if (++this.slow >= 2 && this.tier > 0) {
        this.failed[this.tier] = (this.failed[this.tier] ?? 0) + 1;
        return this.change((this.tier - 1) as Tier);
      }
    } else if (avg < 1 / 57 && this.tier < this.ceiling && (this.failed[this.tier + 1] ?? 0) < 2) {
      this.slow = 0;
      if (++this.fast >= 4) return this.change((this.tier + 1) as Tier);
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    return null;
  }

  private change(t: Tier): Tier {
    this.tier = t;
    this.slow = 0;
    this.fast = 0;
    this.wait = 3;
    return t;
  }
}
