import { EV, NOTE, NOTE_SKIP, SPREAD_REACH } from "@/lib/mass-battle/constants";
import { statusFxType } from "../damage-numbers";
import type { SimReady } from "../protocol";
import type { Hit, Note } from "../view";
import { moveStyle, type Effects, type MoveStyle } from "./effects";
import type { SpeciesForms } from "./forms";
import { ballHeight } from "./units";

/**
 * Turns the battle's hits into what you see and hear, the same way live and
 * in videos: a ranged move launches a little before it lands (a beam, a
 * bolt, a projectile in flight, rocks bursting from the ground), the hit
 * bursts with its type's pieces, a spread move sends a shockwave round its
 * user, a knocked-out Pokémon is recalled into a Poké Ball, and the big
 * moments (a boss hit hard, a crowd knocked out at once, the boss down)
 * punch the camera. A budget per moment of battle keeps a clash of
 * thousands smooth; what's far away or not drawn gets less or nothing.
 */

export interface ActionSummary {
  actor: number;
  move: string;
  type: string;
  kos: number;
  target: number;
  crit: boolean;
  bossHit: boolean;
  bossKo: boolean;
  /** Where it landed (the boss, when it hit the boss). */
  x: number;
  z: number;
  h: number;
  damage: number;
  /** Damage over the target's max HP (the biggest share in the action). */
  share: number;
  superEffective: boolean;
  spread: boolean;
  t: number;
  /** Hits (and misses) in the action. */
  n: number;
}

export interface ChoreoHooks {
  /** Sound for a hit, a recall, a boom. */
  hit?(type: string, power: number, crit: boolean): void;
  recall?(): void;
  /** A finished action, for the kill feed, the director and the swells. */
  action?(a: ActionSummary): void;
  /** A big moment on screen (camera punch, flash), strength 0..1. */
  punch?(x: number, y: number, z: number, strength: number, type: string): void;
  /** A damage number over a target. */
  damage?(x: number, y: number, z: number, damage: number, flags: number, side: number): void;
  /** A note over a unit (a status, healing, a stat stage…), with the height to show it at. */
  note?(n: Note, y: number): void;
  /** Explosion and the like went off here. */
  blast?(x: number, z: number, h: number): void;
}

export interface ChoreoView {
  sp: Uint16Array;
  side: Uint8Array;
  draw: Uint8Array;
  x: Float32Array;
  z: Float32Array;
}

export interface Choreographer {
  launch(h: Hit): void;
  hit(h: Hit): void;
  /** A status, healing, a stat stage…: sparks of its kind on the unit, and its label. */
  note(n: Note): void;
  /** Ends the action in progress (call once a frame after the hits). */
  flush(): void;
  hooks: ChoreoHooks;
  /** Effects per moment of battle (lower on light qualities). */
  budget: number;
}

export function createChoreographer(fx: Effects, view: ChoreoView, ready: SimReady, heights: number[], widths: number[], forms: SpeciesForms[] = []): Choreographer {
  const sp = view.sp;
  const bossSide = ready.start[0] <= 3 && ready.start[1] >= 4 ? 0 : ready.start[1] <= 3 && ready.start[0] >= 4 ? 1 : -1;
  const styles: MoveStyle[][] = ready.moves.map((ms) => ms.map((m) => moveStyle(m.name, m.type, m.contact)));
  let launched = -1;
  let action = -1;
  let act: ActionSummary | null = null;
  let budget = 0, budgetAt = -1;
  const self: Choreographer = {
    hooks: {},
    budget: 70,
    launch(h) {
      if (h.flags & EV.RECOIL || h.action === launched || h.actor === h.target) return;
      launched = h.action;
      const mv = h.slot >= 0 ? ready.moves[sp[h.actor]]?.[h.slot] : null;
      if (!mv || mv.contact) return;
      if (!view.draw[h.actor] && !view.draw[h.target]) return;
      const ha = heights[sp[h.actor]], ht = heights[sp[h.target]];
      const size = Math.min(3, Math.max(0.3, ha));
      if (mv.spread) {
        // A spread move gathers round its user before it goes off.
        fx.impact(mv.type, h.ax, ha * 0.5, h.az, size * 0.6, 0.15, false, Math.max(fx.time.value, h.t - 0.2));
        return;
      }
      fx.launch(mv.type, styles[sp[h.actor]][h.slot], { x: h.ax, y: ha * 0.62, z: h.az }, { x: h.tx, y: ht * 0.5, z: h.tz }, size, h.t);
    },
    hit(h) {
      const mv = h.slot >= 0 ? ready.moves[sp[h.actor]]?.[h.slot] : null;
      const isBoss = bossSide >= 0 && view.side[h.target] === bossSide;
      const ht = heights[sp[h.target]], ha = heights[sp[h.actor]];
      const share = Math.min(1, h.damage / Math.max(1, ready.maxHp[sp[h.target]]));
      if (h.action !== action) {
        self.flush();
        action = h.action;
        act = { actor: h.actor, move: mv?.name ?? "", type: mv?.type ?? "Normal", kos: 0, target: h.target, crit: false, bossHit: false, bossKo: false, x: h.tx, z: h.tz, h: ht, damage: 0, share: 0, superEffective: false, spread: !!mv?.spread, t: h.t, n: 0 };
      }
      const a = act!;
      a.n++;
      if (h.flags & EV.KO) {
        a.kos++;
        if (isBoss) {
          a.bossKo = true;
          a.target = h.target;
          a.x = h.tx;
          a.z = h.tz;
          a.h = ht;
        }
      }
      if (h.flags & EV.CRIT) a.crit = true;
      if (h.flags & EV.SUPER) a.superEffective = true;
      if (isBoss && !(h.flags & (EV.MISS | EV.IMMUNE))) {
        a.bossHit = true;
        a.x = h.tx;
        a.z = h.tz;
        a.h = ht;
      }
      a.damage += h.damage;
      a.share = Math.max(a.share, share);
      const drawnA = view.draw[h.actor], drawnT = view.draw[h.target];
      if (h.flags & EV.BLAST) {
        // Explosion, Self-Destruct, Memento: a big blast where the user stood, a shock ring over everyone it reached, and the camera feels it.
        if (drawnA) {
          const r = ready.radius[sp[h.actor]] + SPREAD_REACH + 0.6;
          const big = Math.min(4, Math.max(1.4, ha * 1.6));
          const type = mv?.type === "Fairy" ? "Fairy" : "Fire";
          fx.impact(type, h.ax, ha * 0.5, h.az, big, 1, true, h.t);
          fx.impact("Normal", h.ax, ha * 0.9, h.az, big * 0.8, 0.8, false, h.t + 0.05);
          fx.spread(type, h.ax, h.az, r, Math.min(3, Math.max(1, ha)), h.t);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            fx.impact(type, h.ax + Math.cos(a) * r * 0.55, ha * 0.4, h.az + Math.sin(a) * r * 0.55, big * 0.45, 0.6, false, h.t + 0.04 + k * 0.02);
          }
          fx.dust(h.ax, h.az, big * 1.4);
          self.hooks.punch?.(h.ax, ha * 0.5, h.az, 0.9, type);
          self.hooks.blast?.(h.ax, h.az, ha);
        }
        if (h.flags & EV.KO) self.hooks.recall?.();
        return;
      }
      // The recall always plays for a drawn Pokémon (nothing just vanishes).
      if (h.flags & EV.KO) {
        if (drawnT) fx.recall(h.tx, 0, h.tz, ht, ballHeight(ht), h.t + 0.22);
        self.hooks.recall?.();
      }
      if (h.flags & EV.RECOIL || !mv) return;
      if (h.t !== budgetAt) {
        budgetAt = h.t;
        budget = self.budget;
      }
      if (!drawnA && !drawnT) return;
      const first = a.n === 1;
      if (first) {
        if (mv.spread && h.flags & EV.SPREAD) fx.spread(mv.type, h.ax, h.az, ready.radius[sp[h.actor]] + SPREAD_REACH + 0.4, Math.min(3, ha));
        self.hooks.hit?.(mv.type, share, !!(h.flags & EV.CRIT));
      }
      if (h.flags & (EV.MISS | EV.IMMUNE)) {
        if (first && h.flags & EV.IMMUNE) fx.impact("Normal", h.tx, ht * 0.5, h.tz, Math.min(ht, 1) * 0.5, 0, false);
        return;
      }
      if (drawnT) self.hooks.damage?.(h.tx, ht * 1.05 + 0.15, h.tz, h.damage, h.flags, view.side[h.target]);
      if (budget <= 0) return;
      budget--;
      const size = Math.min(1.8, Math.max(0.3, Math.min(ht, Math.max(ha, widths[sp[h.actor]]) * 1.5) * 0.7));
      fx.impact(mv.type, h.tx, ht * 0.5, h.tz, size, share, !!(h.flags & EV.CRIT));
      if (isBoss && (share > 0.3 || (h.flags & EV.CRIT && share > 0.15))) self.hooks.punch?.(h.tx, ht * 0.5, h.tz, Math.min(0.85, share * 1.2 + (h.flags & EV.CRIT ? 0.2 : 0)), mv.type);
    },
    note(n) {
      if (n.unit < 0 || n.unit >= sp.length) {
        self.hooks.note?.(n, 1);
        return;
      }
      const ht = heights[sp[n.unit]] ?? 1;
      if (view.draw[n.unit]) {
        const size = Math.min(1.4, Math.max(0.3, ht * 0.7));
        if (n.kind === NOTE.STATUS) {
          const type = statusFxType(n.value);
          if (type) fx.impact(type, n.x, ht * 0.6, n.z, size, 0.3, false, n.t);
        } else if (n.kind === NOTE.HEAL) fx.impact("Grass", n.x, ht * 0.6, n.z, size * 0.7, 0.05, false, n.t);
        else if (n.kind === NOTE.BOOST && (n.value % 16) - 8 > 0) fx.auraDisc("Psychic", n.x, n.z, Math.max(0.6, size), n.t);
        else if (n.kind === NOTE.FORM) {
          // A form or type change: a burst of its type's light and a glow on the ground (the figure changes with it).
          const look = forms[sp[n.unit]]?.forms[n.value];
          const type = look?.type ?? "Normal";
          const big = Math.min(3, Math.max(1.1, ht * (look?.figure ? 1.4 : 1)));
          fx.impact(type, n.x, ht * 0.55, n.z, big, 0.6, false, n.t);
          fx.auraDisc(type, n.x, n.z, Math.max(0.9, big * 1.2), n.t);
        } else if (n.kind === NOTE.SKIP && n.value === NOTE_SKIP.loafing) fx.dust(n.x, n.z, Math.max(0.4, size * 0.8));
        else if (n.kind === NOTE.MOVE) {
          // A move on itself (a boost, healing, Protect, a screen) or charging up: a glow of its type round the user.
          const mv = ready.moves[sp[n.unit]]?.[n.value];
          if (mv) {
            fx.auraDisc(mv.type, n.x, n.z, Math.max(0.7, size * 1.1), n.t);
            fx.impact(mv.type, n.x, ht * 0.6, n.z, size * 0.8, 0.15, false, n.t);
          }
        } else if (n.kind === NOTE.ABILITY) fx.auraDisc("Dark", n.x, n.z, Math.max(0.8, size * 1.2), n.t);
      }
      self.hooks.note?.(n, ht * 1.05 + 0.2);
    },
    flush() {
      if (action < 0 || !act) return;
      const a = act;
      action = -1;
      act = null;
      if (a.bossKo) self.hooks.punch?.(a.x, a.h * 0.5, a.z, 1, a.type);
      else if (a.kos >= 8) self.hooks.punch?.(a.x, a.h * 0.5, a.z, Math.min(0.8, a.kos / 25), a.type);
      self.hooks.action?.(a);
    },
  };
  return self;
}
