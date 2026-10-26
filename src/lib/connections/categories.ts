import { GENERATION_REGIONS, STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { curatedCategories } from "./curated";
import { wordplayCategories } from "./wordplay";
import type { TileRef } from "./mixed";
import { FACTS, MEGA_DISPUTED, MOVES, SV, factsOf, isFriendship, isTrade, nameOf, stoneOf, type Facts, type Region } from "./facts";

/**
 * Every PokéConnections category: a group name, a test over a Pokémon's
 * facts (./facts, read from the committed Pokédex data, never typed in by
 * hand), a line per Pokémon for the "Why?" panel, and how hard it is.
 *
 * - `guard`: a looser test that no Pokémon OUTSIDE the group may pass
 *   either, so nobody gets caught on a technicality (a Pokémon that learns
 *   the group's move by TM, one tied for the group's highest stat).
 * - `lure`: why a Pokémon outside the group might look like it belongs
 *   (a red herring): a dual Fire type beside "Pure Fire". The generator
 *   scores puzzles by these.
 * - `difficulty`: 1 (obvious, yellow) to 4 (obscure, purple), before the
 *   puzzle's own red herrings are counted.
 * - `family`: a puzzle takes at most one category per family, so its four
 *   groups ask four different kinds of question.
 *
 * Categories with too few members to make a group (see MIN_MEMBERS) or that
 * read badly are left out here; BLACKLIST names any found unfair in review.
 */

export type CategoryFamily = "type" | "origin" | "evolution" | "battle" | "stats" | "body" | "forms" | "breeding" | "name" | "wordplay" | "lore";

export interface Category {
  id: string;
  family: CategoryFamily;
  /** The group's name, shown once it's found: "Pure Fire type". */
  label: string;
  /** One sentence for the "Why?" panel: what every member has in common. */
  rule: string;
  difficulty: number;
  test(f: Facts): boolean;
  /** "ability Levitate": why this member belongs (only called on members). */
  why(f: Facts): string;
  guard?(f: Facts): boolean;
  /** Why a non-member looks like it belongs, or null. */
  lure?(f: Facts): string | null;
  /** Its facts come from Scarlet & Violet's learnsets: every tile in the puzzle must be in SV, so each one can be checked. */
  needsSV?: boolean;
  /** A mixed group (./mixed): its tiles can also be moves, abilities and types. */
  mixed?: boolean;
  /** Whether a move, ability or type tile belongs (mixed groups only; every other category rejects them). */
  testTile?(ref: TileRef): boolean;
  /** Why such a tile belongs. */
  whyTile?(ref: TileRef): string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const typeName = (t: string) => cap(t);
const typesText = (f: Facts) => f.types.map(typeName).join("/");
const kg = (hg: number) => `${(hg / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
const metres = (dm: number) => `${(dm / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })} m`;
const REGION_NAME: Record<Region, string> = { alola: "Alolan", galar: "Galarian", hisui: "Hisuian", paldea: "Paldean" };
const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
/** "an Ice Stone", "a Moon Stone". */
export const an = (word: string) => `${/^[AEIOU]/.test(word) ? "an" : "a"} ${word}`;
/** The games' Egg Group names (the data has PokéAPI's ids). */
const EGG_GROUP_NAME: Record<string, string> = {
  Ground: "Field",
  Humanshape: "Human-Like",
  Indeterminate: "Amorphous",
  Plant: "Grass",
  Water1: "Water 1",
  Water2: "Water 2",
  Water3: "Water 3",
};

/** Species only a regional form or variant of evolves (Farfetch’d, Qwilfish, Corsola, Basculin), and Meltan and Melmetal (only in Pokémon GO). */
const EVOLUTION_DISPUTED = new Set([83, 211, 222, 550, 808, 809]);

/** Toedscool and Toedscruel: Grass Egg Group in PokéAPI, Field in Showdown's data. */
const EGG_DISPUTED = new Set([948, 949]);

/** The fewest pool members (from different evolution families: a puzzle has one Pokémon per family) a category needs to be worth using. */
export const MIN_MEMBERS = 5;

/** The type most of a set of Pokémon share (at least 40% of them), for a red herring: "a Steel type that can't have Levitate". */
function dominantType(members: Facts[]): string | null {
  const count = new Map<string, number>();
  for (const f of members) for (const t of f.types) count.set(t, (count.get(t) ?? 0) + 1);
  const [best] = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return best && best[1] >= members.length * 0.4 ? best[0] : null;
}

/** A lure for any category: a Pokémon of the type most of its members share, and what it has instead. */
function typeLure(test: (f: Facts) => boolean, instead: (f: Facts) => string): (f: Facts) => string | null {
  const t = dominantType(FACTS.filter((f) => f.pooled && test(f)));
  if (!t) return () => null;
  return (f) => (f.types.includes(t) ? `${an(typeName(t))} type like most of the group, but ${instead(f)}` : null);
}

const abilitiesText = (f: Facts) =>
  `${f.abilities.length === 1 ? "its only Ability is" : "its Abilities are"} ${f.abilities.map((a) => (a.hidden ? `${a.name} (Hidden)` : a.name)).join(", ")}`;

function evolvesWith(f: Facts, pred: (c: string) => boolean): boolean {
  return f.evolution.some(pred);
}

/** Its evolutions (the Pokémon that evolve from it). */
const evolutionsOf = (f: Facts) => FACTS.filter((g) => g.evolvesFrom === f.id);

function build(): Category[] {
  const out: Category[] = [];
  const pooled = FACTS.filter((f) => f.pooled);
  const types = [...new Set(FACTS.flatMap((f) => f.types))].sort();

  // --- Types -------------------------------------------------------------
  const COLOUR_OF_TYPE: Record<string, string> = { fire: "red", water: "blue", grass: "green", electric: "yellow", psychic: "pink", ice: "white", poison: "purple", ghost: "purple" };
  for (const t of types) {
    const T = typeName(t);
    out.push({
      id: `type:${t}`,
      family: "type",
      label: `${T} type`,
      rule: `Every one is ${T} type (alone or with another type).`,
      difficulty: 1,
      test: (f) => f.types.includes(t),
      why: (f) => typesText(f),
      lure: (f) => {
        if (COLOUR_OF_TYPE[t] && f.color === COLOUR_OF_TYPE[t]) return `its Pokédex colour is ${f.color}, but it's ${typesText(f)}, not ${T}`;
        const kin = f.family.map(factsOf).find((g) => g.id !== f.id && g.types.includes(t));
        return kin ? `its relative ${kin.name} is ${T} type, but ${f.name} is ${typesText(f)}` : null;
      },
    });
    out.push({
      id: `pure:${t}`,
      family: "type",
      label: `Pure ${T} type`,
      rule: `${T} is their one and only type.`,
      difficulty: 1.6,
      test: (f) => f.types.length === 1 && f.types[0] === t,
      why: () => `pure ${T}`,
      lure: (f) => (f.types.includes(t) ? `${T} type, but also ${typeName(f.types.find((x) => x !== t)!)}` : null),
    });
  }
  const combos = new Map<string, string[]>();
  for (const f of pooled) if (f.types.length === 2) combos.set([...f.types].sort().join("/"), [...f.types].sort());
  for (const [key, [a, b]] of combos) {
    const A = typeName(a);
    const B = typeName(b);
    out.push({
      id: `dual:${key}`,
      family: "type",
      label: `${A}/${B} type`,
      rule: `They're all exactly ${A} and ${B}.`,
      difficulty: 1.4,
      test: (f) => f.types.length === 2 && f.types.includes(a) && f.types.includes(b),
      why: (f) => typesText(f),
      lure: (f) => (f.types.includes(a) || f.types.includes(b) ? `${typesText(f)}: half of it` : null),
    });
  }

  // --- Origin: generation, Legendary, Mythical ---------------------------
  for (let g = 1; g <= 9; g++) {
    const region = GENERATION_REGIONS[g];
    out.push({
      id: `gen:${g}`,
      family: "origin",
      label: `Debuted in Gen ${g} (${region})`,
      rule: `All first appeared in Generation ${g}, the ${region} games.`,
      difficulty: g === 1 ? 1.7 : 2.2,
      test: (f) => f.gen === g,
      why: () => `Gen ${g} (${region})`,
      lure: (f) => {
        const kin = f.family.map(factsOf).find((k) => k.gen === g);
        return kin ? `its relative ${kin.name} is from Gen ${g}, but ${f.name} came in Gen ${f.gen}` : null;
      },
    });
  }
  out.push({
    id: "legendary",
    family: "origin",
    label: "Legendary Pokémon",
    rule: "All are Legendary Pokémon (not Mythical).",
    difficulty: 1.3,
    test: (f) => f.legendary,
    why: () => "Legendary",
    lure: (f) => (f.mythical ? "Mythical, which isn't the same as Legendary" : f.bst >= 600 ? `a base stat total of ${f.bst}, but not Legendary` : null),
  });
  out.push({
    id: "mythical",
    family: "origin",
    label: "Mythical Pokémon",
    rule: "All are Mythical Pokémon, the event-only kind.",
    difficulty: 2,
    test: (f) => f.mythical,
    why: () => "Mythical",
    lure: (f) => (f.legendary ? "Legendary, but not Mythical" : null),
  });

  // --- Evolution ---------------------------------------------------------
  out.push({
    id: "baby",
    family: "evolution",
    label: "Baby Pokémon",
    rule: "All are baby Pokémon, the pre-evolutions that hatch from Eggs.",
    difficulty: 2,
    test: (f) => f.baby,
    why: (f) => `baby form of ${evolutionsOf(f).map((g) => g.name).join(" and ") || "its line"}`,
    lure: (f) => {
      const baby = f.family.map(factsOf).find((k) => k.baby);
      return baby && f.evolvesFrom === baby.id ? `${baby.name} is the baby; ${f.name} is what it grows into` : null;
    },
  });
  out.push({
    id: "no-evo",
    family: "evolution",
    label: "Doesn't evolve",
    rule: "None of them evolves or evolves from anything.",
    difficulty: 2.3,
    // Not "alone in its family": Manaphy and Phione share one but neither evolves.
    test: (f) => f.evolvesFrom === null && evolutionsOf(f).length === 0 && !EVOLUTION_DISPUTED.has(f.id),
    // EVOLUTION_DISPUTED: arguable either way, so never in the group nor beside it.
    guard: (f) => EVOLUTION_DISPUTED.has(f.id),
    why: () => "no evolutions",
  });
  const stoneEvos = pooled.filter((f) => f.evolution.some((c) => stoneOf(c)));
  const stoneLure = (stone: string | null) => (f: Facts) => {
    const into = evolutionsOf(f).find((g) => g.evolution.some((c) => (stone ? stoneOf(c) === stone : stoneOf(c))));
    if (into) return `it uses ${an(into.evolution.map(stoneOf).find(Boolean)!)} to evolve into ${into.name}, but wasn't evolved by one`;
    if (stone) {
      const other = f.evolution.map(stoneOf).find((s) => s && s !== stone);
      if (other) return `a stone evolution, but with ${an(other)}`;
    }
    return null;
  };
  out.push({
    id: "stone",
    family: "evolution",
    label: "Evolved with a stone",
    rule: "Each one is reached by using an evolution stone on its pre-evolution.",
    difficulty: 2.1,
    test: (f) => evolvesWith(f, (c) => stoneOf(c) !== null),
    why: (f) => `evolves from ${nameOf(f.evolvesFrom!)} with ${an(f.evolution.map(stoneOf).find(Boolean)!)}`,
    lure: stoneLure(null),
  });
  for (const stone of [...new Set(stoneEvos.flatMap((f) => f.evolution.map(stoneOf).filter((s): s is string => Boolean(s))))].sort()) {
    out.push({
      id: `stone:${stone.toLowerCase().replace(/ /g, "-")}`,
      family: "evolution",
      label: `Evolved with ${an(stone)}`,
      rule: `Each one evolves from its pre-evolution with ${an(stone)}.`,
      difficulty: 2.5,
      test: (f) => evolvesWith(f, (c) => stoneOf(c) === stone),
      why: (f) => `evolves from ${nameOf(f.evolvesFrom!)} with ${an(stone)}`,
      lure: stoneLure(stone),
    });
  }
  out.push({
    id: "trade",
    family: "evolution",
    label: "Trade evolutions",
    rule: "Each one is reached by trading its pre-evolution.",
    difficulty: 2.4,
    test: (f) => evolvesWith(f, isTrade),
    why: (f) => {
      const how = f.evolution.find(isTrade)!;
      return `evolves from ${nameOf(f.evolvesFrom!)} by ${how.replace(/^Trade/, "trade").replace(/^trade for /, "trade for a ")}`;
    },
    lure: (f) => {
      const into = evolutionsOf(f).find((g) => g.evolution.some(isTrade));
      if (into) return `it evolves into ${into.name} by trade, but isn't a trade evolution itself`;
      const held = f.evolution.find((c) => /^Level up holding/.test(c));
      return held ? `it evolves while holding an item (${held.replace(/^Level up holding /, "")}), but by levelling up, not trading` : null;
    },
  });
  out.push({
    id: "friendship",
    family: "evolution",
    label: "Friendship evolutions",
    rule: "Each one evolves from its pre-evolution by levelling up with high friendship.",
    difficulty: 2.8,
    test: (f) => evolvesWith(f, isFriendship),
    why: (f) => `evolves from ${nameOf(f.evolvesFrom!)} with high friendship${/day|night/.test(f.evolution.find(isFriendship)!) ? ` (${f.evolution.find(isFriendship)!.split(", ")[1]})` : ""}`,
    lure: (f) => {
      const into = evolutionsOf(f).find((g) => g.evolution.some(isFriendship));
      return into ? `it evolves into ${into.name} by friendship, but isn't a friendship evolution itself` : null;
    },
  });

  // --- Battle: abilities and moves --------------------------------------
  const abilities = new Map<string, number>();
  for (const f of pooled) for (const a of new Set(f.abilities.map((x) => x.name))) abilities.set(a, (abilities.get(a) ?? 0) + 1);
  for (const [ability, n] of abilities) {
    if (n < MIN_MEMBERS || n > 30) continue;
    const slug = ability.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const has = (f: Facts) => f.abilities.some((a) => a.name === ability);
    out.push({
      id: `ability:${slug}`,
      family: "battle",
      label: `Can have ${ability}`,
      rule: `Every one can have the Ability ${ability} (Hidden Abilities count).`,
      difficulty: 3,
      test: has,
      why: (f) => `${f.abilities.find((a) => a.name === ability)!.hidden ? "Hidden Ability" : "Ability"} ${ability}`,
      lure: typeLure(has, abilitiesText),
    });
    const hidden = (f: Facts) => f.abilities.some((a) => a.name === ability && a.hidden);
    if (pooled.filter(hidden).length >= MIN_MEMBERS) {
      out.push({
        id: `hidden:${slug}`,
        family: "battle",
        label: `Hidden Ability ${ability}`,
        rule: `${ability} is every one's Hidden Ability.`,
        difficulty: 3.6,
        test: hidden,
        // A Pokémon with it as a regular Ability can't sit in another group.
        guard: has,
        why: () => `Hidden Ability ${ability}`,
        lure: typeLure(hidden, abilitiesText),
      });
    }
  }
  // Moves: learnt by level-up in Scarlet & Violet, by a handful of Pokémon, mostly that way (not a TM everyone gets).
  const levelUp = new Map<number, number>();
  const anyWay = new Map<number, number>();
  for (const f of pooled) {
    if (f.learnsetGame !== SV) continue;
    for (const m of f.levelUp.keys()) levelUp.set(m, (levelUp.get(m) ?? 0) + 1);
    for (const m of f.learnable) anyWay.set(m, (anyWay.get(m) ?? 0) + 1);
  }
  for (const [move, n] of levelUp) {
    const info = MOVES[String(move)];
    if (!info || n < MIN_MEMBERS || n > 16 || (anyWay.get(move) ?? 0) > n * 1.5) continue;
    const learns = (f: Facts) => f.learnsetGame === SV && f.levelUp.has(move);
    const moveType = info.type;
    out.push({
      id: `move:${move}`,
      family: "battle",
      label: `Learns ${info.name} by level-up`,
      rule: `Every one learns ${info.name} by levelling up in Scarlet & Violet.`,
      difficulty: 3.7,
      needsSV: true,
      test: learns,
      // Nobody outside the group learns it in SV at all (TM, egg or tutor).
      guard: (f) => f.learnsetGame === SV && f.learnable.has(move),
      why: (f) => {
        const lv = f.levelUp.get(move)!;
        return `learns ${info.name} ${lv === 0 ? "on evolving" : lv === 1 ? "from level 1" : `at level ${lv}`} (SV)`;
      },
      lure: (f) => (f.types.includes(moveType) ? `a ${typeName(moveType)} type, but it doesn't learn ${info.name}` : null),
    });
  }

  // --- Stats -------------------------------------------------------------
  for (const s of STATS) {
    const S = STAT_LABELS[s];
    const others = STATS.filter((x) => x !== s);
    out.push({
      id: `top:${s}`,
      family: "stats",
      label: `Highest stat: ${S}`,
      rule: `${S} is every one's single highest base stat.`,
      difficulty: s === "spe" || s === "atk" ? 2.8 : 3.1,
      test: (f) => others.every((x) => f.stats[s] > f.stats[x]),
      // A Pokémon tied for its highest stat at this one can't sit elsewhere.
      guard: (f) => others.every((x) => f.stats[s] >= f.stats[x]),
      why: (f) => `${S} ${f.stats[s]} is its highest stat`,
      lure: (f) => {
        const top = [...STATS].sort((a, b) => f.stats[b] - f.stats[a]);
        return top[1] === s && f.stats[s] >= 90 ? `${S} ${f.stats[s]}, but its ${STAT_LABELS[top[0]]} (${f.stats[top[0]]}) is higher` : null;
      },
    });
  }
  out.push({
    id: "bst:600",
    family: "stats",
    label: "Base stat total 600+",
    rule: "Their base stats add up to 600 or more.",
    difficulty: 2.4,
    test: (f) => f.bst >= 600,
    why: (f) => `base stat total ${f.bst}`,
    lure: (f) => (f.bst >= 560 ? `a base stat total of ${f.bst}, just short of 600` : null),
  });
  out.push({
    id: "bst:low",
    family: "stats",
    label: "Base stat total under 260",
    rule: "Their base stats add up to less than 260.",
    difficulty: 2.9,
    test: (f) => f.bst < 260,
    why: (f) => `base stat total ${f.bst}`,
    lure: (f) => (f.bst < 300 ? `a base stat total of ${f.bst}, just over 260` : null),
  });

  // --- Body: weight, height, Pokédex colour ------------------------------
  const body: { id: string; label: string; rule: string; test: (f: Facts) => boolean; near: (f: Facts) => boolean; why: (f: Facts) => string }[] = [
    { id: "heavy", label: "Weighs 300 kg or more", rule: "Each one weighs at least 300 kg.", test: (f) => f.weight >= 3000, near: (f) => f.weight >= 2000, why: (f) => `weighs ${kg(f.weight)}` },
    { id: "light", label: "Weighs 1 kg or less", rule: "Each one weighs 1 kg or less.", test: (f) => f.weight <= 10, near: (f) => f.weight <= 20, why: (f) => `weighs ${kg(f.weight)}` },
    { id: "tall", label: "3 m tall or more", rule: "Each one is at least 3 m tall.", test: (f) => f.height >= 30, near: (f) => f.height >= 22, why: (f) => `${metres(f.height)} tall` },
    { id: "short", label: "0.3 m tall or less", rule: "None of them is taller than 0.3 m.", test: (f) => f.height <= 3, near: (f) => f.height <= 4, why: (f) => `${metres(f.height)} tall` },
  ];
  for (const b of body) {
    out.push({
      id: `body:${b.id}`,
      family: "body",
      label: b.label,
      rule: b.rule,
      difficulty: 2.7,
      test: b.test,
      why: b.why,
      lure: (f) => (b.near(f) ? `${b.why(f)}: close, but not quite` : null),
    });
  }
  for (const colour of [...new Set(FACTS.map((f) => f.color))].sort()) {
    const test = (f: Facts) => f.color === colour;
    out.push({
      id: `colour:${colour}`,
      family: "body",
      label: `Pokédex colour: ${cap(colour)}`,
      rule: `The Pokédex files every one of them under the colour ${colour}.`,
      difficulty: 2.2,
      test,
      why: () => `Pokédex colour ${colour}`,
      lure: typeLure(test, (f) => `its Pokédex colour is ${f.color}`),
    });
  }

  // --- Forms -------------------------------------------------------------
  for (const r of ["alola", "galar", "hisui"] as Region[]) {
    const R = REGION_NAME[r];
    out.push({
      id: `form:${r}`,
      family: "forms",
      label: `Has ${an(R)} form`,
      rule: `Each one has ${an(R)} regional form.`,
      difficulty: 2.3,
      test: (f) => f.regionalForms.includes(r),
      why: (f) => `${R} ${f.name} exists`,
      lure: (f) => {
        const other = f.regionalForms.find((x) => x !== r);
        if (other) return `it has ${an(REGION_NAME[other])} form, not ${an(R)} one`;
        const kin = f.family.map(factsOf).find((k) => k.id !== f.id && k.regionalForms.includes(r));
        return kin ? `its relative ${kin.name} has ${an(R)} form, but ${f.name} doesn't` : null;
      },
    });
  }
  out.push({
    id: "form:mega",
    family: "forms",
    label: "Can Mega Evolve",
    rule: "Each one has a Mega Evolution (Legends: Z-A's new Megas included).",
    difficulty: 2.4,
    test: (f) => f.mega,
    guard: (f) => MEGA_DISPUTED.has(f.id),
    why: (f) => `Mega ${f.name} exists`,
    lure: (f) => (f.gmax ? "it has a Gigantamax form, not a Mega Evolution" : null),
  });
  out.push({
    id: "form:gmax",
    family: "forms",
    label: "Has a Gigantamax form",
    rule: "Each one can Gigantamax (Sword & Shield).",
    difficulty: 2.8,
    test: (f) => f.gmax,
    why: (f) => `Gigantamax ${f.name} exists`,
    lure: (f) => (f.mega ? "it can Mega Evolve, but has no Gigantamax form" : null),
  });

  // --- Breeding: Egg Groups and gender ----------------------------------
  for (const raw of [...new Set(FACTS.flatMap((f) => f.eggGroups))].sort()) {
    if (raw === "Ditto" || raw === "No Eggs") continue;
    const group = EGG_GROUP_NAME[raw] ?? raw;
    // Sources disagree on Toedscool and Toedscruel (Grass or Field): never in an Egg Group group, nor beside one.
    const test = (f: Facts) => f.eggGroups.includes(raw) && !EGG_DISPUTED.has(f.id);
    out.push({
      id: `egg:${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      family: "breeding",
      label: `${group} Egg Group`,
      rule: `Every one is in the ${group} Egg Group.`,
      difficulty: group === "Undiscovered" ? 3.2 : 3.4,
      test,
      guard: (f) => EGG_DISPUTED.has(f.id),
      why: (f) => `Egg Group${f.eggGroups.length > 1 ? "s" : ""} ${f.eggGroups.map((g) => EGG_GROUP_NAME[g] ?? g).join(" and ")}`,
      lure: typeLure(test, (f) => `its Egg Group${f.eggGroups.length > 1 ? "s are" : " is"} ${f.eggGroups.map((g) => EGG_GROUP_NAME[g] ?? g).join(" and ")}`),
    });
  }
  out.push({
    id: "gender:male",
    family: "breeding",
    label: "Always male",
    rule: "Every one of them is always male.",
    difficulty: 2.7,
    test: (f) => f.genderRate === 0,
    why: () => "100% male",
    lure: (f) => (f.genderRate === 8 ? "always female, not male" : f.genderRate === 1 ? "male 87.5% of the time, but not always" : null),
  });
  out.push({
    id: "gender:female",
    family: "breeding",
    label: "Always female",
    rule: "Every one of them is always female.",
    difficulty: 2.6,
    test: (f) => f.genderRate === 8,
    why: () => "100% female",
    lure: (f) => (f.genderRate === 0 ? "always male, not female" : f.genderRate >= 6 ? "mostly female, but not always" : null),
  });
  out.push({
    id: "gender:none",
    family: "breeding",
    label: "Genderless",
    rule: "None of them has a gender.",
    difficulty: 2.9,
    test: (f) => f.genderRate === -1,
    why: () => "genderless",
  });

  // --- Names (the English names, as the tiles show them) ----------------
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    out.push({
      id: `letter:${letter.toLowerCase()}`,
      family: "name",
      label: `Starts with ${letter}`,
      rule: `Every name begins with the letter ${letter}.`,
      difficulty: 3.3,
      test: (f) => f.name.startsWith(letter),
      why: (f) => `${f.name}`,
    });
  }
  // Endings that make a fair group (checked by eye in review); a name only counts if it really ends that way.
  for (const ending of ["ite", "eon", "don", "gon", "ile", "uff", "ish", "bat", "dos", "tar", "oom", "rio", "tic", "row", "ash", "king", "ott"]) {
    const letters = (f: Facts) => f.name.toLowerCase().replace(/[^a-z]/g, "");
    out.push({
      id: `ends:${ending}`,
      family: "name",
      label: `Name ends in “-${ending}”`,
      rule: `Every name ends in -${ending}.`,
      difficulty: 3.2,
      test: (f) => f.name.toLowerCase().endsWith(ending),
      guard: (f) => letters(f).endsWith(ending),
      why: (f) => `${f.name.slice(0, -ending.length)}-${f.name.slice(-ending.length)}`,
    });
  }
  out.push({
    id: "name:short",
    family: "name",
    label: "Four letters or fewer",
    rule: "Every name is four letters long or shorter.",
    difficulty: 2.6,
    test: (f) => /^[A-Za-z]{1,4}$/.test(f.name),
    guard: (f) => f.name.replace(/[^A-Za-z]/g, "").length <= 4,
    why: (f) => `${f.name.length} letters`,
    lure: (f) => (/^[A-Za-z]{5}$/.test(f.name) ? `five letters: one too many` : null),
  });
  out.push({
    id: "name:symbol",
    family: "name",
    label: "Not just letters",
    rule: "Every name has something besides letters: a space, a dot, a hyphen, an apostrophe, a colon, an accent, a digit or a symbol.",
    difficulty: 2.9,
    test: (f) => /[^A-Za-z]/.test(f.name),
    why: (f) => {
      const n = f.name;
      if (/[♀♂]/.test(n)) return "a ♀/♂ symbol";
      if (/\d/.test(n)) return "a digit";
      if (/:/.test(n)) return "a colon";
      if (/\./.test(n)) return "a full stop";
      if (/-/.test(n)) return "a hyphen";
      if (/[’']/.test(n)) return "an apostrophe";
      if (/ /.test(n)) return "a space";
      return "an accent";
    },
  });
  // Name wordplay and hand-checked lists (./wordplay, ./curated): blue and purple.
  out.push(...wordplayCategories(new Set(out.map((c) => c.id))), ...curatedCategories());
  return out;
}

/** Ids of categories found unfair or confusing in review: never used. */
export const BLACKLIST = new Set<string>([
  // "Pokédex colour" is data, but Brown/Gray/White/Black are judgement calls for many designs.
  "colour:gray",
  "colour:brown",
  "colour:black",
  "colour:white",
  // Too broad to be a fair group (a third of all Pokémon), or meaningless to players.
  "egg:field",
  "egg:water-1",
  "egg:human-like",
]);

const ALL = build();
/** Every category built, the blacklisted and too-small ones too: anything a player might spot in a grid (tests/connections-accuracy.test.ts checks grids against all of them). */
export const ALL_CATEGORIES: readonly Category[] = ALL;
export const CATEGORIES: Category[] = ALL.filter((c) => !BLACKLIST.has(c.id) && new Set(FACTS.filter((f) => f.pooled && c.test(f)).map((f) => f.familyKey)).size >= MIN_MEMBERS);
const BY_ID = new Map(ALL.map((c) => [c.id, c]));

const EXTRA = new Map<string, Category>();

/** Adds categories that are looked up by id but never drawn as ordinary ones (the mixed groups). */
export function registerCategories(list: readonly Category[]) {
  for (const c of list) EXTRA.set(c.id, c);
}

/** Any category by id, the blacklisted ones too (an old daily may name one). */
export function categoryOf(id: string): Category {
  const c = BY_ID.get(id) ?? EXTRA.get(id);
  if (!c) throw new Error(`No PokéConnections category ${id}`);
  return c;
}
