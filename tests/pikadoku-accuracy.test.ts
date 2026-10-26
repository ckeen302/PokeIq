import { describe, expect, it } from "vitest";
import dexData from "@/data/pokedex.json";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import dailies from "@/data/pikadoku-dailies.json";
import masterSeeds from "@/data/pikadoku-master.json";
import { allCategories, allFacts, baseOf, categoryById, type Facts } from "@/lib/pikadoku/categories";
import { generateGrid, gridFromIds, type PdkGridIds } from "@/lib/pikadoku/generator";
import { checkMaster, MASTER_MIN_ANSWERS, type MasterGrid } from "@/lib/pikadoku/master";
import { solveGrid } from "@/lib/pikadoku/solve";
import { rarityPct, uniquenessScore } from "@/lib/pikadoku/score";
import { rarityLetter } from "@/lib/pikadoku/share";
import { weeklyIds, weekStart, themeFor } from "@/lib/pikadoku/weekly";
import { PDK_DIFFICULTIES, PDK_FAMILIES, PDK_MIN_ANSWERS, type PdkDifficulty } from "@/lib/pikadoku/types";
import { CONN_LAUNCH_DATE } from "@/lib/connections/types";

/**
 * Pikadoku accuracy: every category is judged right for every Pokémon and form,
 * and every upcoming daily can be filled with more than one answer per cell.
 *
 * The first block re-derives each data-backed category straight from the
 * committed PokéAPI data (src/data/pokedex*.json, moves.json), independently of
 * lib/pikadoku/categories, and compares all ~1,175 picks against all ~300
 * categories. The second block pins facts that a player would argue about,
 * checked by hand against the games (Bulbapedia).
 */

interface RawMon {
  id: number;
  name: string;
  gen: number;
  types: string[];
  stats: Record<string, number>;
  legendary: boolean;
  mythical: boolean;
  abilities: { name: string; hidden: boolean }[];
}
interface RawForm {
  id: number;
  slug: string;
  types: string[];
  stats: Record<string, number>;
  abilities: { name: string; hidden: boolean }[];
}
const dex = dexData as unknown as RawMon[];
const details = detailsData as unknown as Record<string, { isBaby: boolean; forms: RawForm[]; learnset: { moves: [number, string, number][] } | null }>;
const moveNames = movesData as unknown as Record<string, { name: string }>;
const species = new Map(dex.map((p) => [p.id, p]));
const formById = new Map<number, RawForm>();
for (const d of Object.values(details)) for (const f of d.forms) formById.set(f.id, f);

/** The raw record behind a pick: its own types, stats and abilities (a form's are its own). */
function raw(f: Facts) {
  const sp = species.get(f.baseId)!;
  const form = f.id === f.baseId ? null : formById.get(f.id)!;
  return { sp, types: form ? form.types : sp.types, stats: form ? form.stats : sp.stats, abilities: form ? form.abilities : sp.abilities };
}
const learns = (baseId: number, move: string) => (details[baseId]?.learnset?.moves ?? []).some((m) => moveNames[m[0]]?.name === move);
const regionalKey = (slug?: string) => slug?.split("-").slice(1).find((x) => ["alola", "galar", "hisui", "paldea"].includes(x));
const GEN_OF_FORM: Record<string, number> = { alola: 7, galar: 8, hisui: 0, paldea: 9 };

/** The independent oracle: null for categories that are curated or need family data (pinned below instead). */
function oracle(cat: string, f: Facts): boolean | null {
  const r = raw(f);
  const [kind, a, b] = cat.split(":");
  const key = regionalKey(f.slug);
  const gen = f.form === "regional" && key ? GEN_OF_FORM[key] : r.sp.gen;
  switch (kind) {
    case "type":
      return r.types.includes(a);
    case "types":
      return a === "dual" ? r.types.length === 2 : r.types.length === 1;
    case "region":
      if (a === "hisui") return null;
      return gen === Number(a);
    case "ability":
      return a === "hidden" ? r.abilities.some((x) => x.hidden) : r.abilities.some((x) => x.name === a);
    case "move":
      return learns(f.baseId, cat.slice(5));
    case "stat": {
      const total = Object.values(r.stats).reduce((x, y) => x + y, 0);
      if (a === "slow") return r.stats.spe <= 40;
      if (a === "bst600") return total >= 600;
      if (a === "bst500") return total >= 500;
      if (a === "bst300") return total < 300;
      return r.stats[a] >= Number(b);
    }
    default:
      break;
  }
  switch (cat) {
    case "other:legendary":
      return r.sp.legendary;
    case "other:mythical":
      return r.sp.mythical;
    case "other:lm":
      return r.sp.legendary || r.sp.mythical;
    case "other:baby":
      return !!details[f.baseId]?.isBaby;
    default:
      return null;
  }
}

describe("every category against the data, for every Pokémon and form", () => {
  const facts = allFacts();
  it("covers every species and every playable form", () => {
    expect(facts.filter((f) => !f.form).length).toBe(dex.length);
    expect(facts.filter((f) => f.form).length).toBeGreaterThanOrEqual(150);
    for (const f of facts) expect(baseOf(f.id)).toBe(f.baseId);
  });
  it("agrees with an independent reading of the data", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const c of allCategories()) {
      for (const f of facts) {
        const want = oracle(c.id, f);
        if (want === null) continue;
        checked++;
        if (c.test(f) !== want) wrong.push(`${c.id} ${f.name}: got ${!want}, data says ${want}`);
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(250_000);
  });
});

const fact = (name: string) => {
  const f = allFacts().find((x) => x.name === name);
  if (!f) throw new Error(`no ${name}`);
  return f;
};
/** [category, Pokémon, expected], each checked by hand against the games. */
const PINNED: [string, string, boolean][] = [
  // Forms keep their own types; region is where the form debuted; a Mega follows its species' region.
  ["type:psychic", "Alolan Raichu", true],
  ["type:psychic", "Raichu", false],
  ["region:7", "Alolan Raichu", true],
  ["region:1", "Alolan Raichu", false],
  ["region:1", "Mega Charizard X", true],
  ["type:dragon", "Mega Charizard X", true],
  ["type:flying", "Mega Charizard X", false],
  ["ability:hidden", "Mega Charizard X", false],
  ["region:hisui", "Hisuian Growlithe", true],
  ["region:hisui", "Kleavor", true], // debuted in Legends: Arceus
  ["region:8", "Kleavor", true], // and is Gen 8 by number
  ["region:hisui", "Scyther", false],
  ["region:9", "Paldean Wooper", true],
  ["form:paldea", "Wooper", true],
  ["form:paldea", "Paldean Wooper", true],
  ["form:alola", "Pikachu", false],
  // Evolution steps count from either side.
  ["evo:stone", "Pikachu", true],
  ["evo:stone", "Raichu", true],
  ["evo:stone", "Alolan Raichu", true],
  ["evo:stone", "Vaporeon", true],
  ["evo:stone", "Eevee", true],
  ["evo:stone", "Chansey", false], // the Oval Stone is held, not an evolution stone
  ["evo:stone", "Charizard", false],
  ["evo:item", "Chansey", true],
  ["evo:item", "Steelix", true], // traded holding a Metal Coat
  ["evo:item", "Wyrdeer", false], // Psyshield Bash is a move
  ["evo:item", "Overqwil", false],
  ["evo:item", "Dipplin", true], // Syrupy Apple
  ["evo:item", "Sinistcha", true],
  ["evo:item", "Archaludon", true],
  ["evo:item", "Kleavor", true], // Black Augurite
  ["evo:trade", "Gengar", true],
  ["evo:trade", "Haunter", true],
  ["evo:trade", "Steelix", true],
  ["evo:trade", "Charizard", false],
  ["evo:friend", "Pikachu", true], // evolved from Pichu by friendship
  ["evo:friend", "Pichu", true],
  ["evo:friend", "Sylveon", true],
  ["evo:friend", "Raichu", false],
  ["evo:level", "Charmeleon", true],
  ["evo:level", "Maushold", true],
  ["evo:level", "Palafin", true],
  ["evo:level", "Pikachu", false],
  ["evo:level", "Gholdengo", false],
  ["evo:branch", "Eevee", true],
  ["evo:branch", "Vaporeon", true],
  ["evo:branch", "Gloom", true],
  ["evo:branch", "Scyther", true], // Scizor or Kleavor
  ["evo:branch", "Magneton", false], // one evolution, several methods
  ["evo:branch", "Charizard", false],
  ["evo:three", "Charmander", true],
  ["evo:three", "Pichu", true],
  ["evo:three", "Eevee", false], // nine species, two stages
  ["evo:three", "Onix", false],
  ["evo:none", "Tauros", true],
  ["evo:none", "Paldean Tauros (Aqua Breed)", true],
  ["evo:none", "Pikachu", false],
  // Baby lines count both ways: with the baby, and as the TCG counts them.
  ["evo:basic", "Pichu", true],
  ["evo:basic", "Pikachu", true],
  ["evo:stage2", "Pikachu", true],
  ["evo:stage2", "Raichu", true],
  ["evo:stage3", "Raichu", true],
  ["evo:stage3", "Charizard", true],
  ["evo:stage2", "Charmander", false],
  ["evo:basic", "Charmeleon", false],
  ["evo:full", "Mega Charizard X", true],
  ["evo:notfull", "Dipplin", true],
  ["evo:full", "Hydrapple", true],
  // Status and curated lists.
  ["other:legendary", "Type: Null", true],
  ["other:legendary", "Buzzwole", false],
  ["other:ultrabeast", "Buzzwole", true],
  ["other:ultrabeast", "Necrozma", false],
  ["other:paradox", "Iron Valiant", true],
  ["other:paradox", "Koraidon", false],
  ["other:fossil", "Aerodactyl", true],
  ["other:fossil", "Mega Aerodactyl", true],
  ["other:baby", "Pichu", true],
  ["other:baby", "Pikachu", false],
  ["other:partner", "Charizard", true],
  ["other:partner", "Mega Charizard X", true],
  ["other:partner", "Pikachu", false],
  ["other:mega", "Charizard", true],
  ["other:mega", "Dragonite", true], // Legends: Z-A
  ["other:mega", "Pikachu", false],
  ["other:gmax", "Pikachu", true],
  ["other:gmax", "Raichu", false],
  ["other:ou", "Ting-Lu", true],
  ["other:ou", "Galarian Slowking", true],
  ["other:ou", "Slowking", false],
  ["other:ou", "Landorus", true], // Landorus-Therian
  ["other:ou", "Great Tusk", true],
  ["other:ou", "Pikachu", false],
  // Moves are the species' (the latest game it is in).
  ["move:Thunderbolt", "Pikachu", true],
  ["move:Thunderbolt", "Partner Pikachu", true],
  ["move:Fly", "Pidgeot", true],
  ["move:Surf", "Charizard", false],
];

describe("pinned facts players would argue about", () => {
  it.each(PINNED)("%s for %s is %s", (cat, name, want) => {
    expect(categoryById(cat), cat).toBeDefined();
    expect(categoryById(cat)!.test(fact(name))).toBe(want);
  });
});

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const FILE = dailies as unknown as Record<string, Record<PdkDifficulty, PdkGridIds>>;
/** Days up to tomorrow (UTC) when this was written were already live and are frozen as published. */
const FROZEN_UNTIL = "2026-10-27";

function expectFillable(ids: PdkGridIds, min: number, label: string) {
  const g = gridFromIds(ids);
  const counts = g.answers.map((a) => a.length);
  expect(Math.min(...counts), `${label} answers per cell ${counts.join(",")}`).toBeGreaterThanOrEqual(min);
  const sol = solveGrid(g.answers);
  expect(sol, `${label} has no 9-Pokémon solution`).not.toBeNull();
  expect(new Set([...sol!.values()].map(baseOf)).size).toBe(9);
  for (const [cell, id] of sol!) expect(g.answers[cell]).toContain(id);
}

describe("every upcoming daily is solvable with more than one answer per cell", () => {
  it("the year of pre-generated dailies (Easy, Normal and Expert)", () => {
    for (const [date, day] of Object.entries(FILE)) {
      for (const d of PDK_DIFFICULTIES) expectFillable(day[d], date <= FROZEN_UNTIL ? 1 : Math.max(2, PDK_MIN_ANSWERS[d]), `${date} ${d}`);
    }
  });
  it("the days past the file, generated from the same seed at runtime", () => {
    const last = Object.keys(FILE).sort().at(-1)!;
    for (let i = 1; i <= 60; i++) {
      const date = addDays(last, i);
      for (const d of PDK_DIFFICULTIES) expectFillable(generateGrid(date, { difficulty: d }), Math.max(2, PDK_MIN_ANSWERS[d]), `${date} ${d}`);
    }
  });
  it("the hand-made Master grids", () => {
    for (const m of masterSeeds as MasterGrid[]) {
      const c = checkMaster(m.rows, m.cols);
      expect(c.ok, `${m.date}: ${c.errors.join(" ")}`).toBe(true);
      expectFillable(m, MASTER_MIN_ANSWERS, `master ${m.date}`);
    }
  });
  it("the weekly themed grids for the next year", () => {
    for (let i = 0; i < 53; i++) {
      const monday = weekStart(addDays(CONN_LAUNCH_DATE, i * 7));
      expectFillable(weeklyIds(monday), Math.max(2, themeFor(monday).min), `week ${monday}`);
    }
  });
  it("a Master grid with a single-answer cell is refused", () => {
    // Ultra Beast × Ghost is Blacephalon alone.
    const c = checkMaster(["other:ultrabeast", "type:fire", "type:water"], ["type:ghost", "type:grass", "type:flying"]);
    expect(c.counts![0]).toBe(1);
    expect(c.ok).toBe(false);
    expect(c.errors.join(" ")).toMatch(/only one valid Pokémon/);
  });
});

describe("Unlimited and duel grids", () => {
  it("deal for every choice of category families, single answers allowed or not", () => {
    // Only moves, only abilities or only regions used to throw (a server error instead of a grid).
    for (let m = 1; m < 1 << PDK_FAMILIES.length; m++) {
      const families = PDK_FAMILIES.filter((_, i) => m & (1 << i));
      for (const allowSingle of [false, true]) {
        const ids = generateGrid(`fam${m}`, { difficulty: "normal", families, allowSingle });
        expectFillable(ids, allowSingle ? 1 : PDK_MIN_ANSWERS.normal, `${families.join(",")} ${allowSingle}`);
      }
    }
  }, 120_000);
  it("keep dealing the same grid for a seed that always worked", () => {
    expect(generateGrid("abc123", { difficulty: "normal" })).toEqual(generateGrid("abc123", { difficulty: "normal" }));
  });
});

describe("rarity scoring", () => {
  it("is the share of players who picked that Pokémon in that cell, to one decimal", () => {
    expect(rarityPct(1, 3)).toBe(33.3);
    expect(rarityPct(3, 3)).toBe(100);
    expect(rarityPct(0, 0)).toBe(100); // nobody yet: no rarity to claim
    expect(rarityPct(5, 2)).toBe(100); // never over 100%
  });
  it("adds up the nine cells, an empty or wrong cell costing 100 (lower is better)", () => {
    expect(uniquenessScore(Array(9).fill(null))).toBe(900);
    expect(uniquenessScore([0.5, 1, 2, 3, 4, 5, 6, 7, 8])).toBe(36.5);
    expect(uniquenessScore([10, null, null, null, null, null, null, null, null])).toBe(810);
  });
  it("colours the share card by rarity, with the thresholds the how-to explains", () => {
    expect(rarityLetter(0.9, true)).toBe("p");
    expect(rarityLetter(1, true)).toBe("b");
    expect(rarityLetter(9.9, true)).toBe("b");
    expect(rarityLetter(10, true)).toBe("g");
    expect(rarityLetter(24.9, true)).toBe("g");
    expect(rarityLetter(25, true)).toBe("y");
    expect(rarityLetter(50, false)).toBe("x");
  });
});
