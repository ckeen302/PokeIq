/**
 * Starting points and Randomise. Presets give every part a colour by its rank (largest part first), keeping each
 * part's own lightness so the figure still reads; Randomise picks a harmony (analogous, complementary, triadic,
 * split-complementary) and leaves locked parts and the outline alone.
 */
import { maxChroma, wrapHue } from "./color";
import type { Species } from "./data";
import { newDesign, quantise, type Design, type PartColour, type PartState } from "./design";
import { partRefs, type Ref } from "./recolor";

export const PRESETS = ["normal", "official", "gold", "silver", "obsidian", "pastel", "neon", "inverted"] as const;
export type Preset = (typeof PRESETS)[number];

export const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"] as const;
export type TypeName = (typeof TYPES)[number];

/** Each type's theme: [lightness, chroma, hue] for the main part, the second, and accents. */
export const TYPE_THEMES: Record<TypeName, [number, number, number][]> = {
  normal: [[0.82, 0.03, 85], [0.66, 0.05, 60], [0.55, 0.12, 30]],
  fire: [[0.68, 0.17, 42], [0.82, 0.14, 80], [0.5, 0.16, 25]],
  water: [[0.66, 0.12, 245], [0.86, 0.06, 215], [0.5, 0.12, 265]],
  grass: [[0.7, 0.15, 140], [0.86, 0.12, 115], [0.62, 0.16, 350]],
  electric: [[0.86, 0.16, 95], [0.48, 0.05, 260], [0.68, 0.17, 45]],
  ice: [[0.88, 0.06, 210], [0.72, 0.09, 230], [0.96, 0.02, 220]],
  fighting: [[0.55, 0.16, 28], [0.8, 0.08, 70], [0.4, 0.05, 260]],
  poison: [[0.58, 0.16, 315], [0.76, 0.14, 140], [0.42, 0.1, 300]],
  ground: [[0.68, 0.1, 70], [0.52, 0.08, 55], [0.84, 0.07, 85]],
  flying: [[0.8, 0.08, 255], [0.95, 0.02, 240], [0.7, 0.13, 50]],
  psychic: [[0.7, 0.16, 350], [0.84, 0.08, 320], [0.62, 0.15, 290]],
  bug: [[0.75, 0.16, 125], [0.5, 0.1, 140], [0.78, 0.15, 75]],
  rock: [[0.64, 0.06, 75], [0.48, 0.04, 60], [0.8, 0.05, 85]],
  ghost: [[0.45, 0.1, 300], [0.3, 0.06, 290], [0.8, 0.12, 175]],
  dragon: [[0.52, 0.17, 275], [0.8, 0.1, 85], [0.6, 0.17, 25]],
  dark: [[0.34, 0.03, 280], [0.22, 0.02, 270], [0.66, 0.18, 20]],
  steel: [[0.78, 0.02, 240], [0.6, 0.03, 235], [0.72, 0.1, 210]],
  fairy: [[0.84, 0.08, 350], [0.95, 0.025, 330], [0.75, 0.1, 280]],
};

/** A soft glow per type for the stage. */
export const TYPE_GLOW: Record<string, string> = {
  normal: "40 20% 70%", fire: "24 95% 58%", water: "212 90% 60%", grass: "130 60% 50%", electric: "50 95% 55%", ice: "190 80% 70%",
  fighting: "10 70% 50%", poison: "290 60% 58%", ground: "35 60% 55%", flying: "225 80% 72%", psychic: "335 85% 65%", bug: "75 70% 45%",
  rock: "45 35% 50%", ghost: "265 50% 55%", dragon: "255 85% 65%", dark: "260 20% 40%", steel: "210 25% 70%", fairy: "320 75% 75%",
};

/** Hot pink, electric cyan, acid green, laser yellow, violet. */
const NEON = [330, 200, 142, 105, 300];

/** Parts by size rank, largest first (outline excluded). */
function ranked(sp: Species): number[] {
  const size = sp.parts.map((p) => p.s.reduce((a, s) => a + (sp.slots[s]?.count ?? 0), 0));
  return sp.parts.map((_, i) => i).filter((i) => !sp.parts[i].o).sort((a, b) => size[b] - size[a]);
}

const col = (l: number, c: number, h: number, k = 1): PartColour => quantise({ l, c: Math.min(c, maxChroma(l, h)), h: wrapHue(h), k });

/** Parts for a preset (outline and locked parts keep their state). */
export function presetParts(sp: Species, d: Design, p: Preset | TypeName, locked: ReadonlySet<number> = new Set()): PartState[] {
  const refs = partRefs(sp, 0);
  const rank = ranked(sp);
  return d.parts.map((st, i) => {
    if (locked.has(i)) return st;
    if (p === "normal") return { src: 0, col: null };
    if (p === "official") return { src: 1, col: null };
    if (sp.parts[i].o) return { src: st.src, col: null };
    const r = rank.indexOf(i);
    const ref: Ref = refs[i];
    const rel = ref.l; // keep the part's lightness, so the figure still reads
    switch (p) {
      case "gold": return { src: 0, col: col(0.5 + rel * 0.38, 0.13 - r * 0.012, 82 - r * 7, 1.1) };
      case "silver": return { src: 0, col: col(0.48 + rel * 0.45, 0.012, 250, 1.15) };
      case "obsidian": return { src: 0, col: r < 2 ? col(0.22 + rel * 0.18, 0.025, 285) : col(0.72, 0.17, r % 2 ? 195 : 45) };
      case "pastel": return { src: 0, col: col(0.84 + (rel - 0.6) * 0.15, Math.min(0.085, ref.c * 0.7 + 0.03), ref.h) };
      case "neon": return { src: 0, col: col(r === 0 ? 0.74 : 0.8, 0.4, NEON[r % NEON.length]) };
      case "inverted": return { src: 0, col: col(ref.l, ref.c, ref.h + 180) };
      default: {
        const theme = TYPE_THEMES[p as TypeName];
        if (!theme) return st;
        const [l, c, h] = theme[Math.min(r, 2)];
        return { src: 0, col: col(l + (rel - 0.6) * 0.15 + (r > 2 ? (r - 2) * 0.05 : 0), c, h + (r > 2 ? (r - 2) * 25 : 0)) };
      }
    }
  });
}

/** Another species' colours, part by part in size order. */
export function borrowParts(sp: Species, d: Design, other: Species, locked: ReadonlySet<number> = new Set()): PartState[] {
  const mine = ranked(sp), theirs = ranked(other);
  const refs = partRefs(other, 1);
  return d.parts.map((st, i) => {
    if (locked.has(i) || sp.parts[i].o) return st;
    const r = mine.indexOf(i);
    const j = theirs[Math.min(r, theirs.length - 1)];
    if (j === undefined) return st;
    const ref = refs[j];
    return { src: 0, col: col(ref.l, ref.c, ref.h) };
  });
}

/** A small seeded random (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARMONIES: number[][] = [
  [0, 30, -30, 60], // analogous
  [0, 180, 20, 200], // complementary
  [0, 120, 240, 60], // triadic
  [0, 150, 210, 30], // split-complementary
];

/** New colours for the unlocked parts, in one harmony. */
export function randomParts(sp: Species, d: Design, locked: ReadonlySet<number>, random: () => number = Math.random): PartState[] {
  const refs = partRefs(sp, 0);
  const rank = ranked(sp);
  const base = random() * 360;
  const harmony = HARMONIES[Math.floor(random() * HARMONIES.length)];
  const vivid = 0.45 + random() * 0.45;
  return d.parts.map((st, i) => {
    if (locked.has(i) || sp.parts[i].o) return st;
    const r = Math.max(0, rank.indexOf(i));
    const ref = refs[i];
    const h = base + harmony[r % harmony.length] + (random() - 0.5) * 16;
    // Keep the part's lightness (within a little), so the figure stays readable.
    const l = Math.min(0.94, Math.max(0.18, ref.l + (random() - 0.5) * 0.16));
    // Parts drawn in greys and whites mostly stay quiet; the rest get colour.
    const quiet = ref.c < 0.035 && random() < 0.7;
    const c = quiet ? random() * 0.035 : Math.min(0.2, maxChroma(l, h) * vivid * (r === 0 ? 0.85 : 1));
    return { src: 0, col: col(l, c, h) };
  });
}

export const DEFAULT_ID = 6;
/** The first design anyone sees: Charizard in obsidian and ember (by part name; anything else from the preset). */
const FIRST_LOOK: Record<string, [number, number, number]> = {
  Body: [0.36, 0.035, 285],
  Belly: [0.7, 0.17, 45],
  Wings: [0.8, 0.13, 82],
  Flame: [0.86, 0.12, 205],
  Claws: [0.93, 0.012, 260],
};

export function firstDesign(sp: Species): Design {
  const d = newDesign(sp.id, sp.parts.length, 1);
  if (sp.id !== DEFAULT_ID) return d;
  d.parts = presetParts(sp, d, "obsidian");
  sp.parts.forEach((p, i) => {
    const look = FIRST_LOOK[p.n];
    if (look) d.parts[i] = { src: 0, col: quantise({ l: look[0], c: look[1], h: look[2], k: 1 }) };
  });
  return d;
}

