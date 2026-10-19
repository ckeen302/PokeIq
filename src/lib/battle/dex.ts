import type { Data, Generation, Generations, Item, Move, Nature, Specie } from "@pkmn/data";
import { BATTLE_FORMATS, type BattleFormat, type BattleFormatId } from "./formats";
import type { SpriteSpecies } from "./sprites";

/**
 * Pokédex data for the Battle pages: @pkmn/dex through @pkmn/data, imported
 * on demand. They weigh ~350 KB gzipped (learnsets another ~400 KB, loaded on
 * the first move list), so they stay out of every other page's bundle.
 */

type Modules = [typeof import("@pkmn/dex"), typeof import("@pkmn/data")];
let modules: Promise<Modules> | null = null;

function loadModules(): Promise<Modules> {
  modules ??= Promise.all([import("@pkmn/dex"), import("@pkmn/data")]);
  // A failed chunk load (offline) can be retried.
  modules.catch(() => (modules = null));
  return modules;
}

const ALLOWED_NONSTANDARD = new Set(["Past", "Unobtainable"]);

/** National Dex: what's in Scarlet / Violet plus everything from earlier games. */
function natDexExists(d: Data): boolean {
  if (!d.exists) return false;
  if ("isNonstandard" in d && d.isNonstandard && !ALLOWED_NONSTANDARD.has(d.isNonstandard)) return false;
  if (d.kind === "Ability" && d.id === "noability") return false;
  return !("natDexTier" in d && ["Illegal", "Unreleased"].includes(d.natDexTier as string));
}

/** The damage calculator takes anything real from the generation, Megas and Z-Crystals included. */
function calcExists(d: Data): boolean {
  if (!d.exists) return false;
  if (d.kind === "Ability" && d.id === "noability") return false;
  return !("isNonstandard" in d && d.isNonstandard && !ALLOWED_NONSTANDARD.has(d.isNonstandard));
}

/** What the set editor needs to know about the rules it edits under: a team-builder format, or a Battle Lab generation. */
export interface DexFormat {
  id: string;
  name: string;
  gen: number;
  /** The level new sets start at. */
  level: number;
  /** The tier the species search lists before anything is typed. */
  homeTier: string;
}

export interface FormatDex {
  format: DexFormat;
  gen: Generation;
  /** Every species a team can start with (no battle-only formes), by Dex number. */
  species: Specie[];
  items: Item[];
  natures: Nature[];
  types: string[];
  /** The species' tier label in this format ("OU", "Uber", "DUU"…). */
  tier(species: Specie): string;
  /** Moves the species can learn in this format, A to Z. */
  learnable(species: string): Promise<Move[]>;
  /** Any move goes (the Battle Lab's Custom Game): `learnable` lists every move, the species' own first. */
  anyMove?: boolean;
}

/** National Dex order, base forms before their formes. */
export function byDexNumber(a: Specie, b: Specie): number {
  return a.num - b.num || Number(a.name !== a.baseSpecies) - Number(b.name !== b.baseSpecies) || a.name.localeCompare(b.name);
}

const formatCache = new Map<BattleFormatId, Promise<FormatDex>>();

export function loadFormatDex(id: BattleFormatId): Promise<FormatDex> {
  let cached = formatCache.get(id);
  if (!cached) {
    cached = buildFormatDex(BATTLE_FORMATS[id]);
    cached.catch(() => formatCache.delete(id));
    formatCache.set(id, cached);
  }
  return cached;
}

async function buildFormatDex(format: BattleFormat): Promise<FormatDex> {
  const [{ Dex }, { Generations }] = await loadModules();
  const gens = format.natDex ? new Generations(Dex, natDexExists) : new Generations(Dex);
  const gen = gens.get(format.gen);
  const species = [...gen.species].filter((s) => !s.battleOnly && s.num > 0).sort(byDexNumber);
  const learnsets = new Map<string, Promise<Move[]>>();
  return {
    format,
    gen,
    species,
    items: [...gen.items].sort((a, b) => a.name.localeCompare(b.name)),
    natures: [...gen.natures].sort((a, b) => a.name.localeCompare(b.name)),
    types: [...gen.types].map((t) => t.name).filter((t) => t !== "???"),
    tier: (s) => String(s[format.tier] ?? ""),
    learnable(name) {
      const specie = gen.species.get(name);
      if (!specie) return Promise.resolve([]);
      let moves = learnsets.get(specie.id);
      if (!moves) {
        moves = gen.learnsets.learnable(specie.name, format.paldeaOnly ? "Paldea" : undefined).then((table) => {
          const out = Object.keys(table ?? {})
            .map((id) => gen.moves.get(id))
            .filter((m): m is Move => !!m);
          // One "Hidden Power" in the learnset means every typed one.
          if (table?.hiddenpower) for (const m of gen.moves) if (m.id.startsWith("hiddenpower") && m.id !== "hiddenpower") out.push(m);
          return out.sort((a, b) => a.name.localeCompare(b.name));
        });
        moves.catch(() => learnsets.delete(specie.id));
        learnsets.set(specie.id, moves);
      }
      return moves;
    },
  };
}

const labCache = new Map<number, Promise<FormatDex>>();

/**
 * A generation's Custom Game, for the Battle Lab: every Pokémon, item and
 * move the generation has (no tiers, no learnset limits, any level).
 */
export function loadLabDex(gen: number): Promise<FormatDex> {
  let cached = labCache.get(gen);
  if (!cached) {
    cached = buildLabDex(gen);
    cached.catch(() => labCache.delete(gen));
    labCache.set(gen, cached);
  }
  return cached;
}

async function buildLabDex(num: number): Promise<FormatDex> {
  const [{ Dex }, { Generations }] = await loadModules();
  const gen = new Generations(Dex, calcExists).get(num);
  const species = [...gen.species].filter((s) => !s.battleOnly && s.num > 0).sort(byDexNumber);
  // Z-Moves and Max Moves come from other moves in battle; Struggle is what's left when nothing else is.
  const allMoves = [...gen.moves].filter((m) => !m.isZ && !m.isMax && m.id !== "struggle").sort((a, b) => a.name.localeCompare(b.name));
  const ordered = new Map<string, Promise<Move[]>>();
  return {
    format: { id: `lab-gen${num}`, name: `Gen ${num}`, gen: num, level: 100, homeTier: "OU" },
    gen,
    species,
    items: [...gen.items].sort((a, b) => a.name.localeCompare(b.name)),
    natures: [...gen.natures].sort((a, b) => a.name.localeCompare(b.name)),
    types: [...gen.types].map((t) => t.name).filter((t) => t !== "???"),
    tier: (s) => String(s.tier ?? ""),
    anyMove: true,
    learnable(name) {
      const specie = gen.species.get(name);
      if (!specie) return Promise.resolve(allMoves);
      let moves = ordered.get(specie.id);
      if (!moves) {
        moves = gen.learnsets
          .learnable(specie.name)
          .then((table) => {
            const own = new Set(Object.keys(table ?? {}));
            return [...allMoves.filter((m) => own.has(m.id)), ...allMoves.filter((m) => !own.has(m.id))];
          })
          .catch(() => allMoves);
        ordered.set(specie.id, moves);
      }
      return moves;
    },
  };
}

/** Sprite ids for any species name, whatever the format. */
export async function loadSpriteLookup(): Promise<(name: string) => SpriteSpecies | null> {
  const [{ Dex }] = await loadModules();
  return (name) => {
    const species = Dex.species.get(name);
    return species.exists ? { id: species.id, num: species.num } : null;
  };
}

let calcGens: Promise<Generations> | null = null;

/** Every generation's data for the damage calculator. */
export function loadCalcGenerations(): Promise<Generations> {
  calcGens ??= loadModules().then(([{ Dex }, { Generations }]) => new Generations(Dex, calcExists));
  calcGens.catch(() => (calcGens = null));
  return calcGens;
}
