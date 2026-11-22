import { registerCategories, type Category } from "./categories";
import { FACTS, MOVES, factsOf, type Facts } from "./facts";
import { ENGLISH_KIT, type Kit } from "./text";
import { ABILITY_BASE, MOVE_BASE, TYPE_BASE, tileKindOf, type ConnTileKind } from "./tiles";

/**
 * Mixed groups: "Fire-related" is a Fire Pokémon, a Fire move, an ability
 * that belongs to Fire types and the Fire type itself. Every link is a type,
 * and every fact is computed from the repo's data:
 * - a Pokémon is Fire when Fire is one of its types;
 * - a move is Fire when the moves data says so (only moves a lot of
 *   Pokémon learn, so players know them);
 * - an ability belongs to a type when at least 60% of the species that can
 *   have it (three or more) are that type, and no other type reaches 60%;
 * - the type tile is the type.
 * Items are skipped: the repo has no item data to compute from.
 *
 * Server-side only, like facts.ts (the data is megabytes).
 */

export interface TileRef {
  kind: ConnTileKind;
  id: number;
  name: string;
  /** The type a move or type tile wears, or an ability's affinity. */
  type?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The types, in a fixed order. */
export const TYPES: string[] = [...new Set(FACTS.flatMap((f) => f.types))].sort();

/** Every ability name, in a fixed order: an ability tile's number is its index here. */
export const ABILITIES: string[] = [...new Set(FACTS.flatMap((f) => f.abilities.map((a) => a.name)))].sort((a, b) => a.localeCompare(b));
const ABILITY_INDEX = new Map(ABILITIES.map((a, i) => [a, i]));

/** Moves that at least this many Pokémon learn: familiar enough to be a tile. */
const POPULAR_LEARNERS = 25;

const learners = new Map<number, number>();
for (const f of FACTS) if (f.pooled) for (const m of f.learnable) learners.set(m, (learners.get(m) ?? 0) + 1);

export const typeTile = (type: string) => TYPE_BASE + TYPES.indexOf(type);
export const moveTile = (moveId: number) => MOVE_BASE + moveId;
export const abilityTile = (name: string) => ABILITY_BASE + (ABILITY_INDEX.get(name) ?? -1);

/** An ability's type, or null when it has none (too few holders, or no clear type). */
const affinity = new Map<string, string | null>();
{
  const holders = new Map<string, Facts[]>();
  for (const f of FACTS) for (const a of f.abilities) holders.set(a.name, [...(holders.get(a.name) ?? []), f]);
  for (const [name, fs] of holders) {
    const near = TYPES.filter((t) => fs.filter((f) => f.types.includes(t)).length >= fs.length * 0.6);
    affinity.set(name, fs.length >= 3 && near.length === 1 ? near[0] : null);
  }
}

/** Decodes a tile number; throws on one that isn't a tile. */
export function tileRef(id: number): TileRef {
  const kind = tileKindOf(id);
  if (kind === "pokemon") return { kind, id, name: factsOf(id).name };
  if (kind === "move") {
    const m = MOVES[String(id - MOVE_BASE)];
    if (!m) throw new Error(`No move tile ${id}`);
    return { kind, id, name: m.name, type: m.type };
  }
  if (kind === "ability") {
    const name = ABILITIES[id - ABILITY_BASE];
    if (!name) throw new Error(`No ability tile ${id}`);
    const type = affinity.get(name);
    return { kind, id, name, ...(type && { type }) };
  }
  const type = TYPES[id - TYPE_BASE];
  if (!type) throw new Error(`No type tile ${id}`);
  return { kind, id, name: cap(type), type };
}

/** The tiles of each kind that belong to a type. */
export function linkTiles(type: string): { moves: number[]; abilities: number[]; type: number } {
  const moves = Object.entries(MOVES)
    .filter(([id, m]) => m.type === type && (learners.get(Number(id)) ?? 0) >= POPULAR_LEARNERS)
    .map(([id]) => moveTile(Number(id)));
  const abilities = ABILITIES.filter((a) => affinity.get(a) === type).map(abilityTile);
  return { moves, abilities, type: typeTile(type) };
}

/** The compositions a mixed group can take (P Pokémon, M move, A ability, T the type). */
export const MIXED_PATTERNS = ["PMAT", "PPMA", "PMMA", "PMAA"] as const;

const count = (p: string, c: string) => p.split(c).length - 1;

/** The patterns a type has enough tiles for. */
export function patternsFor(type: string): string[] {
  const { moves, abilities } = linkTiles(type);
  return MIXED_PATTERNS.filter((p) => count(p, "M") <= moves.length && count(p, "A") <= abilities.length);
}

function mixedCategory(type: string, k: Kit = ENGLISH_KIT): Category {
  const { t } = k;
  const name = k.type(type);
  return {
    id: `mixed:${type}`,
    family: "type",
    label: t("mixed.label", { type: name }),
    rule: t("mixed.rule", { type: name }),
    difficulty: 2.3,
    mixed: true,
    test: (f) => f.types.includes(type),
    why: (f) => t("mixed.why", { types: f.types.map(k.type).join("/") }),
    testTile: (ref) => ref.kind !== "pokemon" && ref.type === type,
    whyTile: (ref) => (ref.kind === "move" ? t("mixed.move", { type: name }) : ref.kind === "ability" ? t("mixed.ability", { type: name }) : t("mixed.type", { type: name })),
  };
}

/** Types that can make a mixed group: enough Pokémon families and a pattern with a move and an ability. */
export const MIXED_TYPES = TYPES.filter(
  (t) => new Set(FACTS.filter((f) => f.pooled && f.types.includes(t)).map((f) => f.familyKey)).size >= 6 && patternsFor(t).length > 0
);

export const MIXED_CATEGORIES: Category[] = MIXED_TYPES.map((t) => mixedCategory(t));
registerCategories(MIXED_CATEGORIES, (k) => MIXED_TYPES.map((t) => mixedCategory(t, k)));
