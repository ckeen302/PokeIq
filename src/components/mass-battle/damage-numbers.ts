import { ABILITY_NOTE, EV, FIELD_NOTE, NOTE, NOTE_CONFUSION, NOTE_ITEM, NOTE_SKIP } from "@/lib/mass-battle/constants";
import { fmt } from "@/lib/mass-battle/copy";

/**
 * Damage numbers over the battle (optional): a small pool of labels that
 * pop up where a hit lands, rise and fade, placed each frame from the 3D
 * point (so they stick to the field as the camera moves). Critical hits
 * are bigger and gold, super-effective hits orange, misses and immunities
 * grey. A crowd of hits shows only a few a moment, the hardest first.
 */

interface Label {
  el: HTMLSpanElement;
  x: number;
  y: number;
  z: number;
  born: number;
  life: number;
  scale: number;
  live: boolean;
  /** Shown even with damage numbers off (a form change). */
  always: boolean;
}

const LIFE = 0.95;

const STATUS_NAME: Record<number, string> = { 1: "Paralysed", 2: "Burned", 3: "Poisoned", 4: "Badly poisoned", 5: "Asleep", 6: "Frozen", [NOTE_CONFUSION]: "Confused", 10: "Seeded" };
const STAT_NAME = ["Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "Accuracy", "Evasion"];
const SKIP_NAME: Record<number, string> = { [NOTE_SKIP.sleep]: "Fast asleep", [NOTE_SKIP.frozen]: "Frozen solid", [NOTE_SKIP.flinch]: "Flinched", [NOTE_SKIP.paralysed]: "Fully paralysed", [NOTE_SKIP.confused]: "Hurt itself", [NOTE_SKIP.loafing]: "Loafing around", [NOTE_SKIP.recharge]: "Recharging", [NOTE_SKIP.failed]: "But it failed" };
const ITEM_NAME: Record<number, string> = { [NOTE_ITEM.sitrus]: "Sitrus Berry", [NOTE_ITEM.lum]: "Lum Berry", [NOTE_ITEM.disguise]: "Disguise", [NOTE_ITEM.sash]: "Focus Sash", [NOTE_ITEM.weaknessPolicy]: "Weakness Policy", [NOTE_ITEM.balloon]: "Air Balloon popped", [NOTE_ITEM.knockedOff]: "Item knocked off" };

const ABILITY_NAME: Record<number, string> = { [ABILITY_NOTE.intimidate]: "Intimidate", [ABILITY_NOTE.trace]: "Trace", [ABILITY_NOTE.download]: "Download", [ABILITY_NOTE.gas]: "Neutralizing Gas", [ABILITY_NOTE.pressure]: "Pressure" };
const WEATHER_START = ["The skies cleared", "The sunlight turned harsh", "It started to rain", "A sandstorm kicked up", "It started to snow"];
const TERRAIN_START = ["The terrain faded", "Electric Terrain spread out", "Grass grew to cover the field", "The field got weird", "Mist swirled over the field"];
const SCREEN_NAME = ["", "Reflect", "Light Screen", "Aurora Veil"];

/** A kill-feed line for a change to the field or an ability as a Pokémon comes in, or null. */
export function fieldLine(kind: number, value: number, who: string): string | null {
  if (kind === NOTE.ABILITY) {
    if (value === ABILITY_NOTE.gas) return `${who}'s Neutralizing Gas filled the area`;
    if (value === ABILITY_NOTE.intimidate) return `${who}'s Intimidate`;
    if (value === ABILITY_NOTE.trace) return `${who} traced an ability`;
    return null;
  }
  if (kind !== NOTE.FIELD) return null;
  const what = Math.floor(value / 16), v = value % 16;
  const by = who ? ` (${who})` : "";
  if (what === FIELD_NOTE.weather) return WEATHER_START[v] ? `${WEATHER_START[v]}${by}` : null;
  if (what === FIELD_NOTE.terrain) return TERRAIN_START[v] ? `${TERRAIN_START[v]}${by}` : null;
  if (what === FIELD_NOTE.screen) return SCREEN_NAME[v % 4] ? `${SCREEN_NAME[v % 4]} went up${by}` : null;
  if (what === FIELD_NOTE.screenEnd) return SCREEN_NAME[v % 4] ? `${SCREEN_NAME[v % 4]} wore off` : null;
  return null;
}

/** The label for a note (a status, healing, chip damage, a stat stage, a lost turn, an item, a form: its name), or null. */
export function noteLabel(kind: number, value: number, form?: string): { text: string; cls: string } | null {
  switch (kind) {
    case NOTE.HEAL: return value > 0 ? { text: `+${fmt(value)}`, cls: "mb-dmg-heal" } : null;
    case NOTE.CHIP: return value > 0 ? { text: `−${fmt(value)}`, cls: "mb-dmg-chip" } : null;
    case NOTE.STATUS: return STATUS_NAME[value] ? { text: STATUS_NAME[value], cls: `mb-dmg-status mb-st-${value}` } : null;
    case NOTE.CURE: return STATUS_NAME[value] ? { text: value === NOTE_CONFUSION ? "Snapped out" : "Cured", cls: "mb-dmg-heal" } : null;
    case NOTE.BOOST: {
      const stat = Math.floor(value / 16), change = (value % 16) - 8;
      if (!STAT_NAME[stat] || !change) return null;
      return { text: `${STAT_NAME[stat]} ${change > 0 ? "↑".repeat(Math.min(3, change)) : "↓".repeat(Math.min(3, -change))}`, cls: change > 0 ? "mb-dmg-up" : "mb-dmg-down" };
    }
    case NOTE.SKIP: return SKIP_NAME[value] ? { text: SKIP_NAME[value], cls: "mb-dmg-miss" } : null;
    case NOTE.ITEM: return ITEM_NAME[value] ? { text: ITEM_NAME[value], cls: "mb-dmg-item" } : null;
    case NOTE.FORM: return form ? { text: form, cls: "mb-dmg-form" } : null;
    case NOTE.MOVE: return form ? { text: form, cls: "mb-dmg-up" } : null;
    case NOTE.PP: return { text: "Out of PP: Struggle", cls: "mb-dmg-miss" };
    case NOTE.ABILITY: return ABILITY_NAME[value] ? { text: ABILITY_NAME[value], cls: "mb-dmg-item" } : null;
  }
  return null;
}

/** The move type whose sparks show a status starting (a burn's embers, paralysis' sparks…). */
export function statusFxType(status: number): string | null {
  return ({ 1: "Electric", 2: "Fire", 3: "Poison", 4: "Poison", 5: "Psychic", 6: "Ice", [NOTE_CONFUSION]: "Psychic" } as Record<number, string>)[status] ?? null;
}

export class DamageNumbers {
  private labels: Label[] = [];
  private next = 0;
  private budget = 0;
  private lastAt = 0;
  enabled = false;

  constructor(private root: HTMLElement, size = 28) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement("span");
      el.className = "mb-dmg";
      el.setAttribute("aria-hidden", "true");
      root.appendChild(el);
      this.labels.push({ el, x: 0, y: 0, z: 0, born: 0, life: LIFE, scale: 1, live: false, always: false });
    }
  }

  /** A hit at a world point; `now` is real seconds. `boss` hits always show. */
  spawn(x: number, y: number, z: number, damage: number, flags: number, now: number, boss: boolean) {
    if (!this.enabled) return;
    this.budget = Math.min(6, this.budget + (now - this.lastAt) * 14);
    this.lastAt = now;
    if (!boss && this.budget < 1) return;
    if (!boss) this.budget -= 1;
    const l = this.labels[this.next];
    this.next = (this.next + 1) % this.labels.length;
    const crit = !!(flags & EV.CRIT), sup = !!(flags & EV.SUPER), res = !!(flags & EV.RESIST);
    let text = fmt(damage);
    let cls = "mb-dmg";
    if (flags & EV.MISS) { text = "Miss"; cls += " mb-dmg-miss"; }
    else if (flags & EV.IMMUNE) { text = "Immune"; cls += " mb-dmg-miss"; }
    else if (crit) cls += " mb-dmg-crit";
    else if (sup) cls += " mb-dmg-super";
    else if (res) cls += " mb-dmg-resist";
    if (boss) cls += " mb-dmg-boss";
    l.el.className = cls;
    l.el.textContent = crit && !(flags & (EV.MISS | EV.IMMUNE)) ? `${text}!` : text;
    l.x = x + (Math.random() - 0.5) * 0.4;
    l.y = y;
    l.z = z + (Math.random() - 0.5) * 0.4;
    l.born = now;
    l.life = crit || boss ? LIFE * 1.3 : LIFE;
    l.always = false;
    l.scale = crit ? 1.35 : boss ? 1.15 : 1;
    l.live = true;
  }

  /** A word over a unit (a status, a stat stage, healing…); `priority` ones always show. */
  spawnText(x: number, y: number, z: number, text: string, cls: string, now: number, priority: boolean, always = false) {
    if (!this.enabled && !always) return;
    this.budget = Math.min(6, this.budget + (now - this.lastAt) * 14);
    this.lastAt = now;
    if (!priority && this.budget < 1) return;
    if (!priority) this.budget -= 1;
    const l = this.labels[this.next];
    this.next = (this.next + 1) % this.labels.length;
    l.el.className = `mb-dmg ${cls}`;
    l.el.textContent = text;
    l.x = x + (Math.random() - 0.5) * 0.3;
    l.y = y;
    l.z = z + (Math.random() - 0.5) * 0.3;
    l.born = now;
    l.life = LIFE * (always ? 1.7 : 1.2);
    l.scale = always ? 1.05 : 0.9;
    l.live = true;
    l.always = always;
  }

  /** Places the live labels for this frame. */
  update(now: number, project: (x: number, y: number, z: number) => { x: number; y: number } | null) {
    for (const l of this.labels) {
      if (!l.live) continue;
      const age = now - l.born;
      if (age > l.life || (!this.enabled && !l.always)) {
        l.live = false;
        l.el.style.opacity = "0";
        continue;
      }
      const p = project(l.x, l.y, l.z);
      if (!p) {
        l.el.style.opacity = "0";
        continue;
      }
      const k = age / l.life;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.6 : 1.2 - Math.min(0.2, (age - 0.12) * 1.5);
      l.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - age * 46).toFixed(1)}px, 0) translate(-50%, -100%) scale(${(pop * l.scale).toFixed(3)})`;
      l.el.style.opacity = String(Math.min(1, (1 - k) * 2.2));
    }
  }

  clear() {
    for (const l of this.labels) {
      l.live = false;
      l.el.style.opacity = "0";
    }
  }

  dispose() {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }
}
