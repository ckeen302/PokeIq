import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Dex, type Species } from "@pkmn/dex";
import dailies from "@/data/connections-dailies.json";
import { categoryOf } from "@/lib/connections/categories";
import { FACTS, factsOf, isFriendship, isTrade, stoneOf, type Facts } from "@/lib/connections/facts";
import { generatePuzzle, groupRating, herringsOf, secondAnswers, validatePuzzle, type Puzzle } from "@/lib/connections/generator";
import { CONN_PACKS } from "@/lib/connections/pack-seed";
import { practiceConnPuzzle } from "@/lib/server/connections";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";

/**
 * PokéConnections' accuracy audit. Three layers:
 * 1. The data: every Pokémon a puzzle can deal is checked against a second
 *    source, Showdown's @pkmn/dex (types, Abilities, stats, generation,
 *    weight, gender, Egg Groups, evolution method, Legendary/Mythical,
 *    regional forms, Megas, Gigantamax). Where the two disagree for a known,
 *    explained reason the difference is listed below; anything else fails.
 * 2. Every daily (past and upcoming) and a spread of generated puzzles
 *    (Unlimited at every difficulty, 5×5, packs, duels): each group's link is
 *    true of every member and of no other tile, judged by an independent
 *    oracle over @pkmn/dex wherever the category can be read from it.
 * 3. No second answers (secondAnswers): no lookalike group of an obvious
 *    kind, no second way to split the grid. Days that were live before this
 *    audit are frozen (players have played them) and only checked for truth.
 */

const DAY_MS = 86_400_000;
const dateOf = (day: number) => new Date(Date.parse(`${dailies.start}T00:00:00Z`) + day * DAY_MS).toISOString().slice(0, 10);
const DAILY: Puzzle[] = dailies.puzzles.map((e) => ({
  groups: e.g.map(([category, ...members]) => ({ category: String(category), members: members.map(Number) })),
  tiles: e.t,
}));
/** Days 1–6 (2026-10-22 to 10-27) were dealt before this audit: they never change. */
const FROZEN_DAYS = 6;

// ---------------------------------------------------------------------------
// The oracle: Showdown's data
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const EGG_NAME: Record<string, string> = { Ground: "Field", Humanshape: "Human-Like", Indeterminate: "Amorphous", Plant: "Grass", Water1: "Water 1", Water2: "Water 2", Water3: "Water 3", "No Eggs": "Undiscovered" };
const dex = (f: Facts): Species => {
  const s = Dex.species.get(f.name);
  if (!s.exists) throw new Error(`${f.name} isn't in @pkmn/dex`);
  return s;
};

/**
 * Known, explained differences between the snapshot (as facts.ts fixes it) and Showdown:
 * - Showdown splits Meowstic, Indeedee and Basculegion into male and female formes (the base one male); the species is 50/50.
 * - Showdown's Minior is the Core form; tiles are the default Meteor form.
 * - Pikachu's "Alola" forme in Showdown is the Alola Cap, not a regional form.
 * - Sylveon: Showdown files the Fairy-move evolution as "levelExtra"; since Gen 8 it is high friendship.
 * - Melmetal: evolves from Meltan only in Pokémon GO, which Showdown leaves out.
 * - Floette: only AZ's Eternal Floette Mega Evolves (facts.ts keeps Floette out of and away from Mega groups).
 * - Toedscool, Toedscruel: Egg Group Grass in PokéAPI, Field in Showdown (kept out of and away from Egg Group groups).
 */
const KNOWN = new Set([
  "Meowstic gender",
  "Indeedee gender",
  "Basculegion gender",
  "Minior stats",
  "Minior weight",
  "Pikachu alola",
  "Sylveon friendship",
  "Melmetal prevo",
  "Floette mega",
  "Toedscool eggs",
  "Toedscruel eggs",
]);

function differences(f: Facts): string[] {
  const s = dex(f);
  const out: string[] = [];
  const add = (what: string, ours: unknown, theirs: unknown) => {
    if (JSON.stringify(ours) !== JSON.stringify(theirs) && !KNOWN.has(`${f.name} ${what}`)) out.push(`${f.name} ${what}: ours ${JSON.stringify(ours)}, Showdown ${JSON.stringify(theirs)}`);
  };
  add("types", f.types.map(norm).sort(), s.types.map(norm).sort());
  add(
    "abilities",
    f.abilities.map((a) => `${norm(a.name)}${a.hidden ? "/H" : ""}`).sort(),
    Object.entries(s.abilities)
      .filter(([k]) => k !== "S")
      .map(([k, v]) => `${norm(v as string)}${k === "H" ? "/H" : ""}`)
      .sort()
  );
  add("stats", f.stats, { hp: s.baseStats.hp, atk: s.baseStats.atk, def: s.baseStats.def, spa: s.baseStats.spa, spd: s.baseStats.spd, spe: s.baseStats.spe });
  add("gen", f.gen, s.gen);
  add("weight", f.weight / 10, s.weightkg);
  add("gender", f.genderRate, s.gender === "N" ? -1 : Math.round(s.genderRatio.F * 8));
  add("eggs", f.eggGroups.map((g) => norm(EGG_NAME[g] ?? g)).sort(), s.eggGroups.map(norm).sort());
  add("prevo", f.evolvesFrom, s.prevo ? Dex.species.get(s.prevo).num : null);
  if (s.prevo) {
    add("stone", f.evolution.map(stoneOf).find(Boolean) ?? null, s.evoType === "useItem" && /Stone$/.test(s.evoItem ?? "") ? s.evoItem : null);
    add("trade", f.evolution.some(isTrade), s.evoType === "trade");
    add("friendship", f.evolution.some(isFriendship), s.evoType === "levelFriendship");
  }
  const tags = s.tags as string[];
  add("legendary", f.legendary, tags.includes("Restricted Legendary") || tags.includes("Sub-Legendary"));
  add("mythical", f.mythical, tags.includes("Mythical"));
  const formes = (s.otherFormes ?? []).map((n) => Dex.species.get(n).forme);
  for (const [r, R] of [["alola", "Alola"], ["galar", "Galar"], ["hisui", "Hisui"]] as const) add(r, f.regionalForms.includes(r), formes.some((x) => x.startsWith(R)));
  add("mega", f.mega, formes.some((x) => x.startsWith("Mega")));
  add("gmax", f.gmax, Boolean(s.canGigantamax));
  return out;
}

/**
 * Whether Showdown's data says a Pokémon passes a category, for every
 * category it can judge (undefined for the rest: name wordplay, hand-checked
 * lists, Scarlet & Violet learnsets, Pokédex colour and height).
 */
function oracle(category: string, f: Facts): boolean | undefined {
  if (KNOWN_ORACLE_SKIP.has(`${f.name} ${category.split(":")[0]}`)) return undefined;
  const s = dex(f);
  const [kind, arg] = [category.split(":")[0], category.slice(category.indexOf(":") + 1)];
  const types = s.types.map(norm);
  const stats = s.baseStats;
  const abilities = Object.entries(s.abilities).filter(([k]) => k !== "S");
  const tags = s.tags as string[];
  const formes = (s.otherFormes ?? []).map((n) => Dex.species.get(n).forme);
  const evos = Dex.species.all().filter((x) => x.prevo === s.name);
  switch (kind) {
    case "type":
      return types.includes(arg);
    case "pure":
      return types.length === 1 && types[0] === arg;
    case "dual":
      return types.length === 2 && arg.split("/").every((t) => types.includes(t));
    case "gen":
      return s.gen === Number(arg);
    case "legendary":
      return tags.includes("Restricted Legendary") || tags.includes("Sub-Legendary");
    case "mythical":
      return tags.includes("Mythical");
    case "ability":
      return abilities.some(([, v]) => norm(v as string) === norm(arg));
    case "hidden":
      return abilities.some(([k, v]) => k === "H" && norm(v as string) === norm(arg));
    case "top": {
      const key = arg as keyof typeof stats;
      return (Object.keys(stats) as (keyof typeof stats)[]).every((k) => k === key || stats[key] > stats[k]);
    }
    case "bst": {
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      return arg === "600" ? total >= 600 : total < 260;
    }
    case "body":
      return arg === "heavy" ? s.weightkg >= 300 : arg === "light" ? s.weightkg <= 1 : undefined;
    case "form":
      if (arg === "mega") return formes.some((x) => x.startsWith("Mega"));
      if (arg === "gmax") return Boolean(s.canGigantamax);
      return formes.some((x) => x.startsWith({ alola: "Alola", galar: "Galar", hisui: "Hisui" }[arg]!));
    case "egg":
      return s.eggGroups.some((g) => norm(g) === norm(arg));
    case "gender":
      return arg === "male" ? s.gender === "M" : arg === "female" ? s.gender === "F" : s.gender === "N";
    case "stone":
      return Boolean(s.prevo) && s.evoType === "useItem" && /Stone$/.test(s.evoItem ?? "") && (category === "stone" || norm(s.evoItem!) === norm(arg));
    case "trade":
      return Boolean(s.prevo) && s.evoType === "trade";
    case "friendship":
      return Boolean(s.prevo) && s.evoType === "levelFriendship";
    case "no-evo":
      return !s.prevo && !evos.length;
    case "letter":
      return f.name.toLowerCase().startsWith(arg);
    default:
      return undefined;
  }
}
/** Pokémon whose known difference (above) makes the oracle's answer for a kind of category moot. */
const KNOWN_ORACLE_SKIP = new Set([
  "Meowstic gender",
  "Indeedee gender",
  "Basculegion gender",
  "Minior top",
  "Minior bst",
  "Minior body",
  "Sylveon friendship",
  "Melmetal no-evo",
  "Floette form",
  "Toedscool egg",
  "Toedscruel egg",
  "Pikachu form",
  // Only a regional form or variant evolves (Sirfetch'd, Overqwil, Cursola, Basculegion): kept out of and away from "Doesn't evolve".
  "Farfetch’d no-evo",
  "Qwilfish no-evo",
  "Corsola no-evo",
  "Basculin no-evo",
  "Meltan no-evo",
]);

/** Every way a puzzle's groups are false: a member the oracle says doesn't fit, or another tile it says does. */
function oracleErrors(p: Puzzle): string[] {
  const out: string[] = [];
  const tiles = p.groups.flatMap((g) => g.members);
  p.groups.forEach((g, gi) => {
    for (const id of tiles) {
      const says = oracle(g.category, factsOf(id));
      if (says === undefined) continue;
      const inGroup = p.groups[gi].members.includes(id);
      if (says !== inGroup) out.push(`${factsOf(id).name} ${inGroup ? "is in" : "is outside"} ${categoryOf(g.category).label}, but Showdown's data says ${says ? "it fits" : "it doesn't"}`);
    }
  });
  return out;
}

const ratingsAscend = (p: Puzzle) => p.groups.every((_, i) => i === 0 || groupRating(p, i) >= groupRating(p, i - 1));

// ---------------------------------------------------------------------------

describe("the data, against a second source", () => {
  it("every Pokémon a puzzle can deal agrees with Showdown's data, but for the known differences", () => {
    const pooled = FACTS.filter((f) => f.pooled);
    expect(pooled.length).toBeGreaterThan(500);
    expect(pooled.flatMap(differences)).toEqual([]);
  });

  it("keeps the fixes the snapshot needed", () => {
    const by = (name: string) => FACTS.find((f) => f.name === name)!;
    expect(by("Dragonite").mega).toBe(true); // Legends: Z-A
    expect(by("Crabominable").evolution).toContain("Use Ice Stone"); // Scarlet & Violet
    expect(by("Ogerpon").genderRate).toBe(8);
    expect(by("Finizen").abilities).toEqual([{ name: "Water Veil", hidden: false }]);
    expect(categoryOf("hidden:water-veil").test(by("Finizen"))).toBe(false);
    expect(categoryOf("gender:none").test(by("Ogerpon"))).toBe(false);
    expect(categoryOf("stone:ice-stone").test(by("Crabominable"))).toBe(true);
  });

  it("the oracle agrees with every category it can judge, for every pooled Pokémon (a sample of categories)", () => {
    const sample = ["type:fire", "pure:water", "dual:flying/normal", "gen:4", "legendary", "mythical", "ability:levitate", "hidden:hustle", "top:spe", "bst:600", "bst:low", "body:heavy", "form:mega", "form:alola", "form:gmax", "egg:monster", "gender:male", "stone", "stone:ice-stone", "trade", "friendship", "no-evo", "letter:s"];
    const wrong: string[] = [];
    for (const f of FACTS.filter((x) => x.pooled)) {
      for (const c of sample) {
        const says = oracle(c, f);
        if (says !== undefined && says !== categoryOf(c).test(f)) wrong.push(`${f.name} ${c}: ours ${categoryOf(c).test(f)}, Showdown ${says}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("every daily", () => {
  it("has 365 days, the frozen ones exactly as they were first dealt", () => {
    expect(DAILY).toHaveLength(365);
    const frozen = createHash("sha256").update(JSON.stringify(dailies.puzzles.slice(0, FROZEN_DAYS))).digest("hex");
    expect(frozen).toBe("2778a2a098b15251d5658ca91fad57b093398688fe0e0b79d5fc333da7d2ceeb");
  });

  it("is 4×4, Pokémon only, and every group is true of its members and no other tile (validatePuzzle and the oracle)", () => {
    const errors: string[] = [];
    DAILY.forEach((p, day) => {
      expect(p.groups).toHaveLength(4);
      expect(p.tiles).toHaveLength(16);
      for (const e of [...validatePuzzle(p), ...oracleErrors(p)]) errors.push(`${dateOf(day)}: ${e}`);
    });
    expect(errors).toEqual([]);
  });

  it("has no lookalike group and only one solution (every day after the frozen ones)", () => {
    const errors: string[] = [];
    DAILY.forEach((p, day) => {
      if (day < FROZEN_DAYS) return;
      for (const e of secondAnswers(p)) errors.push(`${dateOf(day)}: ${e}`);
    });
    expect(errors).toEqual([]);
  });

  it("orders its colours easiest first: ratings ascend, and yellow is never a harder kind of link than purple", () => {
    DAILY.forEach((p, day) => {
      expect(ratingsAscend(p), dateOf(day)).toBe(true);
      const base = p.groups.map((g) => categoryOf(g.category).difficulty);
      expect(base[0], dateOf(day)).toBeLessThan(base[3]);
      expect(base[0], dateOf(day)).toBeLessThan(2.5);
    });
  });

  it("explains every member and every red herring with a line that is true", () => {
    DAILY.forEach((p) => {
      p.groups.forEach((g, gi) => {
        const c = categoryOf(g.category);
        for (const id of g.members) expect(c.why(factsOf(id)).length).toBeGreaterThan(0);
        for (const h of herringsOf(p, gi)) {
          expect(g.members).not.toContain(h.id);
          expect(c.test(factsOf(h.id))).toBe(false);
        }
      });
    });
  });

  it("names the right region for each generation", () => {
    for (let g = 1; g <= 9; g++) expect(categoryOf(`gen:${g}`).label).toContain(GENERATION_REGIONS[g]);
  });
});

describe("generated puzzles", () => {
  const audit = (p: Puzzle, label: string, strict = true) => {
    expect(validatePuzzle(p), label).toEqual([]);
    expect(oracleErrors(p), label).toEqual([]);
    const answers = secondAnswers(p);
    expect(strict ? answers : answers.filter((a) => !a.startsWith("a second solution")), label).toEqual([]);
    expect(ratingsAscend(p), label).toBe(true);
    expect(p.tiles.every((id) => id > 0 && id < 1_000_000), `${label}: Pokémon tiles only`).toBe(true);
  };

  for (const difficulty of ["easy", "normal", "hard"] as const) {
    it(`Unlimited ${difficulty} 4×4: true, unambiguous, ordered`, () => {
      for (let i = 0; i < 12; i++) audit(generatePuzzle(`practice:audit-${difficulty}-${i}`, { difficulty }), `${difficulty} ${i}`);
    });
  }

  it("Unlimited and duels through the server's seeds (4×4 and 5×5)", () => {
    for (const seed of ["audit1", "hard-audit2", "easy-audit3", "s5-audit4", "s5-hard-audit5"]) {
      const p = practiceConnPuzzle(seed);
      audit(p, seed);
      expect(p.groups).toHaveLength(seed.startsWith("s5") ? 5 : 4);
    }
  });

  it("themed packs: true and free of lookalike groups (a close-knit pack may have an odd second split)", () => {
    for (const pack of CONN_PACKS) for (let i = 0; i < 3; i++) audit(generatePuzzle(`audit-${pack}-${i}`, { pack }), `${pack} ${i}`, false);
  });

  it("the daily generator's own fallback (past the file's last day) is held to the same rules", () => {
    for (let i = 0; i < 4; i++) audit(generatePuzzle(`daily:${dateOf(365 + i)}`, {}), dateOf(365 + i));
  });
});
