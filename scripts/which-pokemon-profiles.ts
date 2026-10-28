import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds src/data/which-pokemon-all.json: a light seven-axis profile for
 * every species, derived from its types, evolution stage, stats and the
 * wording of its Pokédex entries, so the "Which Pokémon Are You?" quiz can
 * name a deep-cut match from all 1,025 Pokémon. The curated pool
 * (src/data/which-pokemon.json) is hand-set and overrides nothing here: the
 * deep cut is always a species outside the pool.
 *
 *   npx tsx scripts/which-pokemon-profiles.ts
 */

interface Species {
  id: number;
  slug: string;
  name: string;
  gen: number;
  types: string[];
  stats: Record<string, number>;
  bst: number;
  stage: number;
  fullyEvolved: boolean;
  legendary: boolean;
  mythical: boolean;
  flavor: string[];
}

const root = process.cwd();
const dex = JSON.parse(readFileSync(join(root, "src/data/pokedex.json"), "utf8")) as Species[];
const details = JSON.parse(readFileSync(join(root, "src/data/pokedex-details.json"), "utf8")) as Record<string, { entries?: { text: string }[] }>;

// Axis order: E A C O S K I.
type Vec = [number, number, number, number, number, number, number];
const zero = (): Vec => [0, 0, 0, 0, 0, 0, 0];

/** What each type says about temperament, in points. */
const TYPE: Record<string, Partial<Record<number, number>>> = {
  normal: { 1: 4 },
  fire: { 0: 6, 5: 6 },
  water: { 1: 4, 4: 4 },
  electric: { 0: 8, 5: 2 },
  grass: { 1: 5, 4: 3, 5: -3 },
  ice: { 0: -5, 4: 4, 6: 3 },
  fighting: { 5: 10, 2: 5, 0: 3 },
  poison: { 1: -6, 6: 4 },
  ground: { 4: 6, 2: 3, 3: -3 },
  flying: { 3: 4, 6: 5, 0: 3 },
  psychic: { 3: 8, 0: -4, 2: 3 },
  bug: { 2: 5, 0: -2, 5: 2 },
  rock: { 4: 5, 2: 4, 3: -4 },
  ghost: { 0: -8, 3: 6, 6: 5, 1: -3 },
  dragon: { 5: 8, 6: 5, 4: 2 },
  dark: { 1: -8, 6: 6, 5: 3 },
  steel: { 2: 8, 4: 6, 1: -2 },
  fairy: { 1: 8, 0: 4, 5: -5 },
};

/** Pokédex wording, each hit ±3 points on an axis (capped at ±18 per axis). */
const WORDS: [number, 1 | -1, RegExp][] = [
  [0, 1, /\b(playful|cheerful|lively|sociable|flocks?|herds?|groups?|packs?|dances?|dancing|sings?|singing|energetic|mischievous|loves to play)\b/g],
  [0, -1, /\b(timid|shy|quiet|hides?|hiding|alone|solitary|lurks?|avoids? (people|humans)|rarely seen|nocturnal|lone|reclusive)\b/g],
  [1, 1, /\b(gentle|kind|docile|friendly|affection\w*|caring|heals?|healing|protects?|peace\w*|shares?|helps?|helping|loving|tender|warm-hearted)\b/g],
  [1, -1, /\b(ferocious|vicious|aggressive|attacks?|violent|brutal|cruel|savage|fierce|merciless|hostile|prey|bites?|rampag\w+|tears? (apart|up)|ruthless)\b/g],
  [2, 1, /\b(diligent|hard-?working|tireless|carefully|patient\w*|disciplined|meticulous|builds?|building|trains?|training|works?|working|dams?|nests?|stores? (up|food))\b/g],
  [2, -1, /\b(lazy|laziest|sleeps?|sleeping|asleep|idle|carefree|easygoing|laid-?back|forgets?|forgetful|clumsy|dozes?|naps?|napping|absent-?minded)\b/g],
  [3, 1, /\b(curious|clever|intelligen\w+|mysterious|dreams?|strange|unknown|changes?|adapts?|explor\w+|wanders?|wandering|travels?|travelling|imitat\w+|mimics?)\b/g],
  [3, -1, /\b(stubborn|same (spot|place|route)|never changes|habit|routine|territor\w+|ancient|traditional|refuses? to)\b/g],
  [4, 1, /\b(calm\w*|peaceful|serene|composed|unfazed|fearless|never panics|tranquil|steady|stoic|unbothered|nerves of steel|relaxed)\b/g],
  [4, -1, /\b(nervous|afraid|frighten\w*|scared|panics?|cries|crying|worr\w+|startled|anxious|skittish|fears?|terrified|tears)\b/g],
  [5, 1, /\b(battles?|fights?|fighting|rivals?|rivalry|strong\w*|powerful|victor\w+|challeng\w+|proud|pride|compet\w+|dominat\w+|conquer\w*|hunts?|hunting|predator|warrior|champion)\b/g],
  [5, -1, /\b(gentle|peaceful|playful|shy|avoids? (fights|battles|conflict)|flees?|runs? away|harmless|docile|weak\w*|cowardly)\b/g],
  [6, 1, /\b(alone|solitary|wanders?|roams?|lone|independent|territor\w+|lives by itself|avoids?|rarely|hermit|loner|nomad\w*)\b/g],
  [6, -1, /\b(trainers?|flocks?|herds?|packs?|groups?|loyal\w*|follows?|family|families|together|companions?|partners?|obeys?|obedient|devoted|protects? its (young|family|trainer)|friends?)\b/g],
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A small deterministic jitter so twins don't land on the same point. */
function jitter(id: number, axis: number): number {
  const h = Math.imul(id * 7919 + axis * 104729, 2654435761) >>> 0;
  return ((h % 5) - 2) * 0.8;
}

const rows = dex.map((s) => {
  const v = zero();
  for (const t of s.types) for (const [axis, pts] of Object.entries(TYPE[t] ?? {})) v[Number(axis)] += pts ?? 0;
  const texts = new Set<string>(s.flavor);
  for (const e of details[String(s.id)]?.entries ?? []) texts.add(e.text);
  const text = [...texts].join(" ").toLowerCase();
  const hits = zero();
  for (const [axis, sign, re] of WORDS) {
    const n = (text.match(re) ?? []).length;
    hits[axis] += sign * n * 3;
  }
  for (let i = 0; i < 7; i++) v[i] += clamp(hits[i], -18, 18);
  const baby = s.stage === 1 && !s.fullyEvolved;
  if (baby) {
    v[1] += 4;
    v[5] -= 6;
    v[2] -= 3;
    v[4] -= 3;
  } else if (s.fullyEvolved && s.stage >= 2) {
    v[5] += 5;
    v[4] += 3;
    v[2] += 2;
  }
  if (s.legendary || s.mythical) {
    v[6] += 12;
    v[5] += 8;
    v[4] += 6;
    v[0] -= 5;
  }
  v[5] += clamp((s.bst - 430) / 20, -8, 8);
  v[0] += clamp((s.stats.spe - 70) / 15, -5, 5);
  const p = v.map((x, i) => Math.round(clamp(50 + x + jitter(s.id, i), 8, 92)));
  return [s.id, s.slug, s.name, s.types.join("/"), ...p];
});

const out = join(root, "src/data/which-pokemon-all.json");
writeFileSync(out, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
console.log(`wrote ${rows.length} profiles to ${out}`);
