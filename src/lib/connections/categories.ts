import type { StatKey } from "@/lib/pokemon/constants";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { curatedCategories } from "./curated";
import { wordplayCategories } from "./wordplay";
import type { TileRef } from "./mixed";
import { FACTS, MEGA_DISPUTED, MOVES, SV, factsOf, isFriendship, isTrade, stoneOf, type Facts, type Region } from "./facts";
import { ENGLISH_KIT, an, kitFor, type Kit } from "./text";

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
  /**
   * The group is about the English names' letters or spelling (first letters, endings, hidden words, rhymes, what a
   * name was borrowed from): it only works with the English names, so other languages swap it out (./localize).
   */
  englishOnly?: boolean;
  /** Whether a move, ability or type tile belongs (mixed groups only; every other category rejects them). */
  testTile?(ref: TileRef): boolean;
  /** Why such a tile belongs. */
  whyTile?(ref: TileRef): string;
}

const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
/** "an Ice Stone", "a Moon Stone". */
export { an };
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

function evolvesWith(f: Facts, pred: (c: string) => boolean): boolean {
  return f.evolution.some(pred);
}

/** Its evolutions (the Pokémon that evolve from it). */
const evolutionsOf = (f: Facts) => FACTS.filter((g) => g.evolvesFrom === f.id);

/** "Level up holding Razor Claw, at night" → the item and when, or null. */
function heldItem(condition: string): { item: string; time: string | null } | null {
  const m = /^Level up holding (.+?)(?:, (during the day|at night))?$/.exec(condition);
  return m ? { item: m[1], time: m[2] ?? null } : null;
}

/** "during the day" / "at night" in the kit's language. */
const timeOf = (k: Kit, english: string) => k.t(english === "at night" ? "time.night" : "time.day");

/**
 * Every category, its words from the kit (./text): the same tests, guards, lures and difficulties in every language,
 * only the words differ.
 */
function build(k: Kit): Category[] {
  const { t } = k;
  const out: Category[] = [];
  const pooled = FACTS.filter((f) => f.pooled);
  const types = [...new Set(FACTS.flatMap((f) => f.types))].sort();
  const name = (f: Facts) => k.pokemon(f.name, f.id);
  const nameOfId = (id: number) => name(factsOf(id));
  const typeName = (ty: string) => k.type(ty);
  const typesText = (f: Facts) => f.types.map(typeName).join("/");

  /** A lure for any category: a Pokémon of the type most of its members share, and what it has instead. */
  function typeLure(test: (f: Facts) => boolean, instead: (f: Facts) => string): (f: Facts) => string | null {
    const ty = dominantType(FACTS.filter((f) => f.pooled && test(f)));
    if (!ty) return () => null;
    return (f) => (f.types.includes(ty) ? t("lureTypeLike", { type: k.a(typeName(ty)), instead: instead(f) }) : null);
  }

  const abilitiesText = (f: Facts) =>
    t(f.abilities.length === 1 ? "list.abilitiesOne" : "list.abilitiesMany", {
      list: k.comma(f.abilities.map((a) => (a.hidden ? t("list.hiddenMark", { name: k.ability(a.name) }) : k.ability(a.name)))),
    });

  // --- Types -------------------------------------------------------------
  const COLOUR_OF_TYPE: Record<string, string> = { fire: "red", water: "blue", grass: "green", electric: "yellow", psychic: "pink", ice: "white", poison: "purple", ghost: "purple" };
  for (const ty of types) {
    const T = typeName(ty);
    out.push({
      id: `type:${ty}`,
      family: "type",
      label: t("type.label", { type: T }),
      rule: t("type.rule", { type: T }),
      difficulty: 1,
      test: (f) => f.types.includes(ty),
      why: (f) => typesText(f),
      lure: (f) => {
        if (COLOUR_OF_TYPE[ty] && f.color === COLOUR_OF_TYPE[ty]) return t("type.lureColour", { colour: k.colour(f.color), types: typesText(f), type: T });
        const kin = f.family.map(factsOf).find((g) => g.id !== f.id && g.types.includes(ty));
        return kin ? t("type.lureKin", { kin: name(kin), type: T, name: name(f), types: typesText(f) }) : null;
      },
    });
    out.push({
      id: `pure:${ty}`,
      family: "type",
      label: t("pure.label", { type: T }),
      rule: t("pure.rule", { type: T }),
      difficulty: 1.6,
      test: (f) => f.types.length === 1 && f.types[0] === ty,
      why: () => t("pure.why", { type: T }),
      lure: (f) => (f.types.includes(ty) ? t("pure.lure", { type: T, other: typeName(f.types.find((x) => x !== ty)!) }) : null),
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
      label: t("dual.label", { a: A, b: B }),
      rule: t("dual.rule", { a: A, b: B }),
      difficulty: 1.4,
      test: (f) => f.types.length === 2 && f.types.includes(a) && f.types.includes(b),
      why: (f) => typesText(f),
      lure: (f) => (f.types.includes(a) || f.types.includes(b) ? t("dual.lure", { types: typesText(f) }) : null),
    });
  }

  // --- Origin: generation, Legendary, Mythical ---------------------------
  for (let g = 1; g <= 9; g++) {
    const region = k.genRegion(g);
    out.push({
      id: `gen:${g}`,
      family: "origin",
      label: t("gen.label", { gen: g, region }),
      rule: t("gen.rule", { gen: g, region }),
      difficulty: g === 1 ? 1.7 : 2.2,
      test: (f) => f.gen === g,
      why: () => t("gen.why", { gen: g, region }),
      lure: (f) => {
        const kin = f.family.map(factsOf).find((x) => x.gen === g);
        return kin ? t("gen.lure", { kin: name(kin), gen: g, name: name(f), own: f.gen }) : null;
      },
    });
  }
  out.push({
    id: "legendary",
    family: "origin",
    label: t("legendary.label"),
    rule: t("legendary.rule"),
    difficulty: 1.3,
    test: (f) => f.legendary,
    why: () => t("legendary.why"),
    lure: (f) => (f.mythical ? t("legendary.lureMythical") : f.bst >= 600 ? t("legendary.lureBst", { bst: f.bst }) : null),
  });
  out.push({
    id: "mythical",
    family: "origin",
    label: t("mythical.label"),
    rule: t("mythical.rule"),
    difficulty: 2,
    test: (f) => f.mythical,
    why: () => t("mythical.why"),
    lure: (f) => (f.legendary ? t("mythical.lure") : null),
  });

  // --- Evolution ---------------------------------------------------------
  out.push({
    id: "baby",
    family: "evolution",
    label: t("baby.label"),
    rule: t("baby.rule"),
    difficulty: 2,
    test: (f) => f.baby,
    why: (f) => {
      const into = evolutionsOf(f).map(name);
      return into.length ? t("baby.why", { names: k.and(into) }) : t("baby.whyLine");
    },
    lure: (f) => {
      const baby = f.family.map(factsOf).find((x) => x.baby);
      return baby && f.evolvesFrom === baby.id ? t("baby.lure", { baby: name(baby), name: name(f) }) : null;
    },
  });
  out.push({
    id: "no-evo",
    family: "evolution",
    label: t("noEvo.label"),
    rule: t("noEvo.rule"),
    difficulty: 2.3,
    // Not "alone in its family": Manaphy and Phione share one but neither evolves.
    test: (f) => f.evolvesFrom === null && evolutionsOf(f).length === 0 && !EVOLUTION_DISPUTED.has(f.id),
    // EVOLUTION_DISPUTED: arguable either way, so never in the group nor beside it.
    guard: (f) => EVOLUTION_DISPUTED.has(f.id),
    why: () => t("noEvo.why"),
  });
  const stoneEvos = pooled.filter((f) => f.evolution.some((c) => stoneOf(c)));
  const aStone = (stone: string) => k.a(k.item(stone));
  const stoneLure = (stone: string | null) => (f: Facts) => {
    const into = evolutionsOf(f).find((g) => g.evolution.some((c) => (stone ? stoneOf(c) === stone : stoneOf(c))));
    if (into) return t("stone.lureInto", { stone: aStone(into.evolution.map(stoneOf).find(Boolean)!), into: name(into) });
    if (stone) {
      const other = f.evolution.map(stoneOf).find((s) => s && s !== stone);
      if (other) return t("stone.lureOther", { stone: aStone(other) });
    }
    return null;
  };
  out.push({
    id: "stone",
    family: "evolution",
    label: t("stone.label"),
    rule: t("stone.rule"),
    difficulty: 2.1,
    test: (f) => evolvesWith(f, (c) => stoneOf(c) !== null),
    why: (f) => t("stone.why", { from: nameOfId(f.evolvesFrom!), stone: aStone(f.evolution.map(stoneOf).find(Boolean)!) }),
    lure: stoneLure(null),
  });
  for (const stone of [...new Set(stoneEvos.flatMap((f) => f.evolution.map(stoneOf).filter((s): s is string => Boolean(s))))].sort()) {
    out.push({
      id: `stone:${stone.toLowerCase().replace(/ /g, "-")}`,
      family: "evolution",
      label: t("stone.oneLabel", { stone: aStone(stone) }),
      rule: t("stone.oneRule", { stone: aStone(stone) }),
      difficulty: 2.5,
      test: (f) => evolvesWith(f, (c) => stoneOf(c) === stone),
      why: (f) => t("stone.why", { from: nameOfId(f.evolvesFrom!), stone: aStone(stone) }),
      lure: stoneLure(stone),
    });
  }
  out.push({
    id: "trade",
    family: "evolution",
    label: t("trade.label"),
    rule: t("trade.rule"),
    difficulty: 2.4,
    test: (f) => evolvesWith(f, isTrade),
    why: (f) => {
      const how = f.evolution.find(isTrade)!;
      const from = nameOfId(f.evolvesFrom!);
      const holding = /^Trade holding (.+)$/.exec(how);
      if (holding) return t("trade.whyHolding", { from, item: k.item(holding[1]) });
      const partner = /^Trade for (.+)$/.exec(how);
      if (partner) {
        const p = FACTS.find((x) => x.name === partner[1]);
        return t("trade.whyFor", { from, pokemon: p ? name(p) : partner[1] });
      }
      return t("trade.why", { from });
    },
    lure: (f) => {
      const into = evolutionsOf(f).find((g) => g.evolution.some(isTrade));
      if (into) return t("trade.lureInto", { into: name(into) });
      const held = f.evolution.map(heldItem).find(Boolean);
      if (!held) return null;
      return held.time ? t("trade.lureHeldTime", { item: k.item(held.item), time: timeOf(k, held.time) }) : t("trade.lureHeld", { item: k.item(held.item) });
    },
  });
  out.push({
    id: "friendship",
    family: "evolution",
    label: t("friendship.label"),
    rule: t("friendship.rule"),
    difficulty: 2.8,
    test: (f) => evolvesWith(f, isFriendship),
    why: (f) => {
      const how = f.evolution.find(isFriendship)!;
      const from = nameOfId(f.evolvesFrom!);
      return /day|night/.test(how) ? t("friendship.whyTime", { from, time: timeOf(k, how.split(", ")[1]) }) : t("friendship.why", { from });
    },
    lure: (f) => {
      const into = evolutionsOf(f).find((g) => g.evolution.some(isFriendship));
      return into ? t("friendship.lure", { into: name(into) }) : null;
    },
  });

  // --- Battle: abilities and moves --------------------------------------
  const abilities = new Map<string, number>();
  for (const f of pooled) for (const a of new Set(f.abilities.map((x) => x.name))) abilities.set(a, (abilities.get(a) ?? 0) + 1);
  for (const [ability, n] of abilities) {
    if (n < MIN_MEMBERS || n > 30) continue;
    const slug = ability.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const A = k.ability(ability);
    const has = (f: Facts) => f.abilities.some((a) => a.name === ability);
    out.push({
      id: `ability:${slug}`,
      family: "battle",
      label: t("ability.label", { ability: A }),
      rule: t("ability.rule", { ability: A }),
      difficulty: 3,
      test: has,
      why: (f) => t(f.abilities.find((a) => a.name === ability)!.hidden ? "ability.whyHidden" : "ability.why", { ability: A }),
      lure: typeLure(has, abilitiesText),
    });
    const hidden = (f: Facts) => f.abilities.some((a) => a.name === ability && a.hidden);
    if (pooled.filter(hidden).length >= MIN_MEMBERS) {
      out.push({
        id: `hidden:${slug}`,
        family: "battle",
        label: t("hidden.label", { ability: A }),
        rule: t("hidden.rule", { ability: A }),
        difficulty: 3.6,
        test: hidden,
        // A Pokémon with it as a regular Ability can't sit in another group.
        guard: has,
        why: () => t("ability.whyHidden", { ability: A }),
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
    const M = k.move(info.name);
    out.push({
      id: `move:${move}`,
      family: "battle",
      label: t("move.label", { move: M }),
      rule: t("move.rule", { move: M }),
      difficulty: 3.7,
      needsSV: true,
      test: learns,
      // Nobody outside the group learns it in SV at all (TM, egg or tutor).
      guard: (f) => f.learnsetGame === SV && f.learnable.has(move),
      why: (f) => {
        const lv = f.levelUp.get(move)!;
        return lv === 0 ? t("move.whyEvolving", { move: M }) : lv === 1 ? t("move.whyStart", { move: M }) : t("move.whyLevel", { move: M, level: lv });
      },
      lure: (f) => (f.types.includes(moveType) ? t("move.lure", { type: typeName(moveType), move: M }) : null),
    });
  }

  // --- Stats -------------------------------------------------------------
  for (const s of STATS) {
    const S = k.stat(s);
    const others = STATS.filter((x) => x !== s);
    out.push({
      id: `top:${s}`,
      family: "stats",
      label: t("top.label", { stat: S }),
      rule: t("top.rule", { stat: S }),
      difficulty: s === "spe" || s === "atk" ? 2.8 : 3.1,
      test: (f) => others.every((x) => f.stats[s] > f.stats[x]),
      // A Pokémon tied for its highest stat at this one can't sit elsewhere.
      guard: (f) => others.every((x) => f.stats[s] >= f.stats[x]),
      why: (f) => t("top.why", { stat: S, value: f.stats[s] }),
      lure: (f) => {
        const top = [...STATS].sort((a, b) => f.stats[b] - f.stats[a]);
        return top[1] === s && f.stats[s] >= 90 ? t("top.lure", { stat: S, value: f.stats[s], top: k.stat(top[0]), topValue: f.stats[top[0]] }) : null;
      },
    });
  }
  out.push({
    id: "bst:600",
    family: "stats",
    label: t("bst.highLabel"),
    rule: t("bst.highRule"),
    difficulty: 2.4,
    test: (f) => f.bst >= 600,
    why: (f) => t("bst.why", { bst: f.bst }),
    lure: (f) => (f.bst >= 560 ? t("bst.lureHigh", { bst: f.bst }) : null),
  });
  out.push({
    id: "bst:low",
    family: "stats",
    label: t("bst.lowLabel"),
    rule: t("bst.lowRule"),
    difficulty: 2.9,
    test: (f) => f.bst < 260,
    why: (f) => t("bst.why", { bst: f.bst }),
    lure: (f) => (f.bst < 300 ? t("bst.lureLow", { bst: f.bst }) : null),
  });

  // --- Body: weight, height, Pokédex colour ------------------------------
  const weighs = (f: Facts) => t("body.weighs", { kg: k.num(f.weight / 10) });
  const tall = (f: Facts) => t("body.height", { m: k.num(f.height / 10) });
  const body: { id: string; label: string; rule: string; test: (f: Facts) => boolean; near: (f: Facts) => boolean; why: (f: Facts) => string }[] = [
    { id: "heavy", label: t("body.heavyLabel"), rule: t("body.heavyRule"), test: (f) => f.weight >= 3000, near: (f) => f.weight >= 2000, why: weighs },
    { id: "light", label: t("body.lightLabel"), rule: t("body.lightRule"), test: (f) => f.weight <= 10, near: (f) => f.weight <= 20, why: weighs },
    { id: "tall", label: t("body.tallLabel"), rule: t("body.tallRule"), test: (f) => f.height >= 30, near: (f) => f.height >= 22, why: tall },
    { id: "short", label: t("body.shortLabel"), rule: t("body.shortRule"), test: (f) => f.height <= 3, near: (f) => f.height <= 4, why: tall },
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
      lure: (f) => (b.near(f) ? t("body.lure", { why: b.why(f) }) : null),
    });
  }
  for (const colour of [...new Set(FACTS.map((f) => f.color))].sort()) {
    const test = (f: Facts) => f.color === colour;
    out.push({
      id: `colour:${colour}`,
      family: "body",
      label: t("colour.label", { Colour: k.Colour(colour) }),
      rule: t("colour.rule", { colour: k.colour(colour) }),
      difficulty: 2.2,
      test,
      why: () => t("colour.why", { colour: k.colour(colour) }),
      lure: typeLure(test, (f) => t("colour.lure", { colour: k.colour(f.color) })),
    });
  }

  // --- Forms -------------------------------------------------------------
  for (const r of ["alola", "galar", "hisui"] as Region[]) {
    const R = k.formRegion(r);
    out.push({
      id: `form:${r}`,
      family: "forms",
      label: t("form.label", { region: k.a(R) }),
      rule: t("form.rule", { region: k.a(R) }),
      difficulty: 2.3,
      test: (f) => f.regionalForms.includes(r),
      why: (f) => t("form.why", { region: R, name: name(f) }),
      lure: (f) => {
        const other = f.regionalForms.find((x) => x !== r);
        if (other) return t("form.lureOther", { other: k.a(k.formRegion(other)), region: k.a(R) });
        const kin = f.family.map(factsOf).find((x) => x.id !== f.id && x.regionalForms.includes(r));
        return kin ? t("form.lureKin", { kin: name(kin), region: k.a(R), name: name(f) }) : null;
      },
    });
  }
  out.push({
    id: "form:mega",
    family: "forms",
    label: t("mega.label"),
    rule: t("mega.rule"),
    difficulty: 2.4,
    test: (f) => f.mega,
    guard: (f) => MEGA_DISPUTED.has(f.id),
    why: (f) => t("mega.why", { name: name(f) }),
    lure: (f) => (f.gmax ? t("mega.lure") : null),
  });
  out.push({
    id: "form:gmax",
    family: "forms",
    label: t("gmax.label"),
    rule: t("gmax.rule"),
    difficulty: 2.8,
    test: (f) => f.gmax,
    why: (f) => t("gmax.why", { name: name(f) }),
    lure: (f) => (f.mega ? t("gmax.lure") : null),
  });

  // --- Breeding: Egg Groups and gender ----------------------------------
  const eggName = (raw: string) => k.egg(EGG_GROUP_NAME[raw] ?? raw);
  const eggList = (f: Facts) => k.and(f.eggGroups.map(eggName));
  for (const raw of [...new Set(FACTS.flatMap((f) => f.eggGroups))].sort()) {
    if (raw === "Ditto" || raw === "No Eggs") continue;
    const group = EGG_GROUP_NAME[raw] ?? raw;
    const G = k.egg(group);
    // Sources disagree on Toedscool and Toedscruel (Grass or Field): never in an Egg Group group, nor beside one.
    const test = (f: Facts) => f.eggGroups.includes(raw) && !EGG_DISPUTED.has(f.id);
    out.push({
      id: `egg:${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      family: "breeding",
      label: t("egg.label", { group: G }),
      rule: t("egg.rule", { group: G }),
      difficulty: group === "Undiscovered" ? 3.2 : 3.4,
      test,
      guard: (f) => EGG_DISPUTED.has(f.id),
      why: (f) => t("egg.why", { n: f.eggGroups.length, groups: eggList(f) }),
      lure: typeLure(test, (f) => t("egg.lure", { n: f.eggGroups.length, groups: eggList(f) })),
    });
  }
  out.push({
    id: "gender:male",
    family: "breeding",
    label: t("gender.maleLabel"),
    rule: t("gender.maleRule"),
    difficulty: 2.7,
    test: (f) => f.genderRate === 0,
    why: () => t("gender.maleWhy"),
    lure: (f) => (f.genderRate === 8 ? t("gender.maleLureFemale") : f.genderRate === 1 ? t("gender.maleLureMostly") : null),
  });
  out.push({
    id: "gender:female",
    family: "breeding",
    label: t("gender.femaleLabel"),
    rule: t("gender.femaleRule"),
    difficulty: 2.6,
    test: (f) => f.genderRate === 8,
    why: () => t("gender.femaleWhy"),
    lure: (f) => (f.genderRate === 0 ? t("gender.femaleLureMale") : f.genderRate >= 6 ? t("gender.femaleLureMostly") : null),
  });
  out.push({
    id: "gender:none",
    family: "breeding",
    label: t("gender.noneLabel"),
    rule: t("gender.noneRule"),
    difficulty: 2.9,
    test: (f) => f.genderRate === -1,
    why: () => t("gender.noneWhy"),
  });

  // --- Names (the English names, as the English tiles show them) ---------
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    out.push({
      id: `letter:${letter.toLowerCase()}`,
      family: "name",
      englishOnly: true,
      label: t("letter.label", { letter }),
      rule: t("letter.rule", { letter }),
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
      englishOnly: true,
      label: t("ends.label", { ending }),
      rule: t("ends.rule", { ending }),
      difficulty: 3.2,
      test: (f) => f.name.toLowerCase().endsWith(ending),
      guard: (f) => letters(f).endsWith(ending),
      why: (f) => `${f.name.slice(0, -ending.length)}-${f.name.slice(-ending.length)}`,
    });
  }
  out.push({
    id: "name:short",
    family: "name",
    englishOnly: true,
    label: t("short.label"),
    rule: t("short.rule"),
    difficulty: 2.6,
    test: (f) => /^[A-Za-z]{1,4}$/.test(f.name),
    guard: (f) => f.name.replace(/[^A-Za-z]/g, "").length <= 4,
    why: (f) => t("short.why", { n: f.name.length }),
    lure: (f) => (/^[A-Za-z]{5}$/.test(f.name) ? t("short.lure") : null),
  });
  out.push({
    id: "name:symbol",
    family: "name",
    englishOnly: true,
    label: t("symbol.label"),
    rule: t("symbol.rule"),
    difficulty: 2.9,
    test: (f) => /[^A-Za-z]/.test(f.name),
    why: (f) => {
      const n = f.name;
      if (/[♀♂]/.test(n)) return t("symbol.gender");
      if (/\d/.test(n)) return t("symbol.digit");
      if (/:/.test(n)) return t("symbol.colon");
      if (/\./.test(n)) return t("symbol.stop");
      if (/-/.test(n)) return t("symbol.hyphen");
      if (/[’']/.test(n)) return t("symbol.apostrophe");
      if (/ /.test(n)) return t("symbol.space");
      return t("symbol.accent");
    },
  });
  // Name wordplay and hand-checked lists (./wordplay, ./curated): blue and purple.
  out.push(...wordplayCategories(new Set(out.map((c) => c.id)), k), ...curatedCategories(k));
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

const ALL = build(ENGLISH_KIT);
/** Every category built, the blacklisted and too-small ones too: anything a player might spot in a grid (tests/connections-accuracy.test.ts checks grids against all of them). */
export const ALL_CATEGORIES: readonly Category[] = ALL;
export const CATEGORIES: Category[] = ALL.filter((c) => !BLACKLIST.has(c.id) && new Set(FACTS.filter((f) => f.pooled && c.test(f)).map((f) => f.familyKey)).size >= MIN_MEMBERS);
const BY_ID = new Map(ALL.map((c) => [c.id, c]));

const EXTRA = new Map<string, Category>();
/** Builds the extra categories (the mixed groups) in a language. */
const extraBuilders: ((k: Kit) => readonly Category[])[] = [];

/**
 * Adds categories that are looked up by id but never drawn as ordinary ones (the mixed groups): their English ones,
 * and how to write them in another language.
 */
export function registerCategories(list: readonly Category[], inLanguage?: (k: Kit) => readonly Category[]) {
  for (const c of list) EXTRA.set(c.id, c);
  if (inLanguage) extraBuilders.push(inLanguage);
}

/** Every category by id in each other language, built the first time it's asked for. */
const LOCAL = new Map<Locale, Map<string, Category>>();
function localCategories(locale: Locale): Map<string, Category> {
  let map = LOCAL.get(locale);
  if (!map) {
    const k = kitFor(locale);
    map = new Map([...build(k), ...extraBuilders.flatMap((b) => b(k))].map((c) => [c.id, c]));
    LOCAL.set(locale, map);
  }
  return map;
}

/**
 * Any category by id, the blacklisted ones too (an old daily may name one). `locale`: its words in that language
 * (the same category otherwise).
 */
export function categoryOf(id: string, locale: Locale = DEFAULT_LOCALE): Category {
  const c = locale === DEFAULT_LOCALE ? (BY_ID.get(id) ?? EXTRA.get(id)) : localCategories(locale).get(id);
  if (!c) throw new Error(`No PokéConnections category ${id}`);
  return c;
}
