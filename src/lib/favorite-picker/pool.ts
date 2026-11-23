import { CAT, GENERATIONS, TYPES, type FormKind, type Mon, type TypeName } from "@/lib/tier-list/types";

/**
 * The picker's pool: which Pokémon a run starts from. Generations and types are sets (none chosen means all), a
 * category narrows it further, and each kind of form can be let in. A form counts as its species for the category
 * (Mega Charizard is a starter's form) and has its own types and generation.
 */

export const POOL_CATEGORIES = ["all", "starter", "legendary", "mythical", "pseudo", "ultraBeast", "paradox", "fossil", "eeveelution"] as const;
export type PoolCategory = (typeof POOL_CATEGORIES)[number];

export const FORM_KINDS: readonly FormKind[] = ["regional", "mega", "gmax", "other"];

export interface PoolConfig {
  /** Bit g − 1 per generation; 0 for every generation. */
  gens: number;
  /** Bit i per TYPES[i]; 0 for every type. */
  types: number;
  cat: PoolCategory;
  /** Bit i per FORM_KINDS[i]: that kind of form joins the pool. */
  forms: number;
}

export const ALL_POOL: PoolConfig = { gens: 0, types: 0, cat: "all", forms: 0 };

export const typeBit = (t: string) => {
  const i = TYPES.indexOf(t as TypeName);
  return i < 0 ? 0 : 1 << i;
};
export const formBit = (f: FormKind) => 1 << FORM_KINDS.indexOf(f);

/** A pool of one type with the forms the player lets in (the type chart's runs). */
export const typePool = (type: TypeName, forms: number): PoolConfig => ({ gens: 0, types: typeBit(type), cat: "all", forms });

/** The pool's Pokémon, in roster order. */
export function poolMons(mons: readonly Mon[], c: PoolConfig): Mon[] {
  const base = new Map<string, Mon>();
  for (const m of mons) if (!m.f) base.set(m.k, m);
  const catBit = c.cat === "all" ? 0 : CAT[c.cat];
  return mons.filter((m) => {
    if (m.f && !(c.forms & formBit(m.f))) return false;
    if (c.gens && !(c.gens & (1 << (m.g - 1)))) return false;
    if (c.types && !m.t.some((t) => c.types & typeBit(t))) return false;
    if (catBit) {
      const cats = m.c | (m.s ? (base.get(m.s)?.c ?? 0) : 0);
      if (!(cats & catBit)) return false;
    }
    return true;
  });
}

/** The generations and types a pool takes, as lists (for labels). */
export const poolGens = (c: PoolConfig) => GENERATIONS.filter((g) => c.gens & (1 << (g - 1)));
export const poolTypes = (c: PoolConfig) => TYPES.filter((t) => c.types & typeBit(t));

export function cleanPool(c: Partial<PoolConfig> | null | undefined): PoolConfig {
  const n = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 2 ** max ? v : 0);
  return {
    gens: n(c?.gens, GENERATIONS.length),
    types: n(c?.types, TYPES.length),
    cat: POOL_CATEGORIES.includes(c?.cat as PoolCategory) ? (c!.cat as PoolCategory) : "all",
    forms: n(c?.forms, FORM_KINDS.length),
  };
}
