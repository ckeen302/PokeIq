import { Dex } from "@pkmn/dex";
import type { Rng } from "@/lib/rng";
import type { Difficulty, GenerateOptions, Question, QuestionBuilder } from "../types";

/**
 * Ability, Move & Item quiz, generated from the Pokémon Showdown data
 * (@pkmn/dex, current generation). Questions are pure functions of the Rng,
 * so the server re-derives them when grading. Entries are sorted by id so
 * the pools (and the `used` keys) are stable.
 */

const gen = Dex.forGen(9);

const TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];
const CATEGORIES = ["Physical", "Special", "Status"];
/** Moves whose type or category isn't one fixed value. */
const VARIABLE_MOVES = new Set(["hiddenpower", "naturalgift", "weatherball", "judgment", "terrablast", "revelationdance", "multiattack", "technoblast", "ivycudgel", "terastarstorm", "aurawheel", "raginggale", "struggle", "curse", "return", "frustration", "present", "magnitude"]);

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : 1);

interface Entry { key: number; gen: number }
interface AbilityEntry extends Entry { name: string; desc: string; species: string[] }
interface MoveEntry extends Entry { name: string; type: string; category: string }
interface ItemEntry extends Entry { name: string; desc: string; berry: boolean }

interface Bank {
  abilities: AbilityEntry[];
  /** Species a distractor may come from, by name. */
  speciesNames: string[];
  moves: MoveEntry[];
  items: ItemEntry[];
  /** Ability id -> every base species (formes included) that can have it. */
  abilityHolders: Map<string, Set<string>>;
}

let cached: Bank | null = null;

function bank(): Bank {
  if (cached) return cached;
  const allSpecies = gen.species.all().filter((s) => s.exists && s.num > 0);
  // ability id -> every species name (any forme) that can have it
  const abilityHolders = new Map<string, Set<string>>();
  for (const s of allSpecies) {
    for (const a of Object.values(s.abilities)) {
      const id = a.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!abilityHolders.has(id)) abilityHolders.set(id, new Set());
      abilityHolders.get(id)!.add(s.baseSpecies);
    }
  }
  const base = allSpecies.filter((s) => !s.isNonstandard && !s.forme && s.num <= 1025).sort(byId);
  const speciesNames = base.map((s) => s.name);
  const baseSet = new Set<string>(speciesNames);
  const abilities: AbilityEntry[] = gen.abilities
    .all()
    .filter((a) => a.exists && !a.isNonstandard && a.id !== "noability" && a.shortDesc)
    .sort(byId)
    .map((a, i) => ({
      key: 300_000 + i,
      gen: a.gen,
      name: a.name,
      desc: a.shortDesc,
      species: [...(abilityHolders.get(a.id) ?? [])].filter((n) => baseSet.has(n as string)).sort(),
    }));
  const moves: MoveEntry[] = gen.moves
    .all()
    .filter((m) => m.exists && !m.isNonstandard && !m.isZ && !m.isMax && !VARIABLE_MOVES.has(m.id))
    .sort(byId)
    .map((m, i) => ({ key: 310_000 + i, gen: m.gen, name: m.name, type: m.type, category: m.category }));
  const items: ItemEntry[] = gen.items
    .all()
    .filter((it) => it.exists && !it.isNonstandard && it.shortDesc && !it.megaStone && !it.zMove && !it.itemUser && !it.onPlate && !it.onMemory && !it.onDrive && !it.name.includes("Tera Shard"))
    .filter((it) => !it.shortDesc.toLowerCase().includes(it.name.toLowerCase()))
    .sort(byId)
    .map((it, i) => ({ key: 320_000 + i, gen: it.gen, name: it.name, desc: it.shortDesc, berry: !!it.isBerry }));
  return (cached = { abilities, speciesNames, moves, items, abilityHolders });
}

const MAX_GEN: Record<Difficulty, number> = { easy: 4, medium: 7, hard: 99 };

function ratingFor(kind: Kind, g: number): number {
  const kindBase = { holder: 1250, "move-type": 1000, "move-category": 1050, "item-desc": 1200, "ability-desc": 1250 }[kind];
  return Math.min(1500, Math.max(800, kindBase + (g - 5) * 25));
}

type Kind = "holder" | "move-type" | "move-category" | "item-desc" | "ability-desc";
const KINDS: Kind[] = ["holder", "move-type", "move-category", "item-desc", "ability-desc"];
const KIND_WEIGHTS: Record<Kind, number> = { holder: 0.25, "move-type": 0.25, "move-category": 0.1, "item-desc": 0.25, "ability-desc": 0.15 };

function pickKind(rng: Rng): Kind {
  let roll = rng.next();
  for (const k of KINDS) if ((roll -= KIND_WEIGHTS[k]) < 0) return k;
  return KINDS[0];
}

/** Open entries: unused, and inside the generation filter (or the difficulty's cap). */
function open<T extends Entry>(list: T[], opts: GenerateOptions): T[] {
  const filter = opts.gens && opts.gens.length > 0 ? new Set(opts.gens) : null;
  const cap = MAX_GEN[opts.difficulty];
  return list.filter((e) => !opts.used.has(e.key) && (filter ? filter.has(e.gen) : e.gen <= cap));
}

export const competitive: QuestionBuilder = (rng, opts): Question | null => {
  const b = bank();
  const kind = pickKind(rng);
  const make = (
    id: string,
    entry: Entry,
    prompt: string,
    answer: string,
    wrong: string[],
    explanation: string,
    detail?: string
  ): Question => {
    opts.used.add(entry.key);
    return {
      itemKey: `competitive:${kind}:${id}`,
      module: "competitive",
      prompt,
      detail,
      options: rng.shuffle([answer, ...wrong]),
      answer,
      explanation,
      rating: ratingFor(kind, entry.gen),
    };
  };

  if (kind === "holder") {
    const pool = open(b.abilities, opts).filter((a) => a.species.length > 0);
    if (pool.length === 0) return null;
    const a = rng.pick(pool);
    const answer = rng.pick(a.species);
    const holders = b.abilityHolders.get(a.name.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? new Set<string>();
    const wrong = rng.sample(b.speciesNames.filter((n) => !holders.has(n)), 3);
    return make(a.name, a, `Which of these Pokémon can have the ability ${a.name}?`, answer, wrong, `${answer} can have ${a.name}.`);
  }
  if (kind === "move-type" || kind === "move-category") {
    const pool = open(b.moves, opts);
    if (pool.length === 0) return null;
    const m = rng.pick(pool);
    if (kind === "move-type") {
      return make(m.name, m, `What type is the move ${m.name}?`, m.type, rng.sample(TYPES.filter((t) => t !== m.type), 3), `${m.name} is a ${m.type}-type move.`, "In the current games");
    }
    return make(m.name, m, `Is the move ${m.name} Physical, Special or Status?`, m.category, CATEGORIES.filter((c) => c !== m.category), `${m.name} is a ${m.category} move.`, "In the current games");
  }
  if (kind === "item-desc") {
    const pool = open(b.items, opts);
    if (pool.length === 0) return null;
    const it = rng.pick(pool);
    const same = b.items.filter((o) => o.berry === it.berry && o.desc !== it.desc);
    const wrong = [...new Set(rng.sample(same, 8).map((o) => o.desc))].slice(0, 3);
    if (wrong.length < 3) return null;
    return make(it.name, it, `What does the item ${it.name} do?`, it.desc, wrong, `${it.name}: ${it.desc}`);
  }
  const pool = open(b.abilities, opts);
  if (pool.length === 0) return null;
  const a = rng.pick(pool);
  const others = b.abilities.filter((o) => o.desc !== a.desc);
  const wrong = [...new Set(rng.sample(others, 8).map((o) => o.desc))].slice(0, 3);
  if (wrong.length < 3) return null;
  return make(a.name, a, `What does the ability ${a.name} do?`, a.desc, wrong, `${a.name}: ${a.desc}`);
};
