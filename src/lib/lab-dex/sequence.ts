import { matchesDexQuery, normalizeDexQuery } from "@/lib/pokemon/dex-search";
import { TYPES } from "@/lib/pokemon/type-matrix";
import { ROLES, roleScore, type RoleKey } from "./roles";
import type { LabMon } from "./types";

/**
 * The wheel's sequence: every Pokémon (and, with Forms on, every form right
 * after its species), filtered exactly like the Pokédex page (types, all of
 * them; generations, any of them; Legendary + Mythical; Fully evolved) and
 * sorted by number, name, base stat total, a base stat or a battle role.
 * The view's state lives in the URL (/lab/pokedex?pick=6&type=fire&sort=spe).
 */

export type StatSort = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type SortKey = "id" | "name" | "bst" | StatSort | RoleKey;

export const STAT_SORTS: StatSort[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Sorts that read best smallest (or A) first; the rest start with the biggest. */
export const ASCENDING_FIRST: SortKey[] = ["id", "name"];

export interface LabView {
  types: string[];
  gens: number[];
  legends: boolean;
  final: boolean;
  forms: boolean;
  sort: SortKey;
  /** Reverse of the sort's natural direction. */
  reverse: boolean;
}

export const DEFAULT_VIEW: LabView = { types: [], gens: [], legends: false, final: false, forms: false, sort: "id", reverse: false };

const SORT_PARAM: Record<SortKey, string> = {
  id: "id",
  name: "name",
  bst: "bst",
  hp: "hp",
  atk: "atk",
  def: "def",
  spa: "spa",
  spd: "spd",
  spe: "spe",
  ...(Object.fromEntries(ROLES.map((r) => [r.key, r.param])) as Record<RoleKey, string>),
};
const PARAM_SORT = new Map(Object.entries(SORT_PARAM).map(([k, v]) => [v, k as SortKey]));

function sortValue(m: LabMon, key: SortKey): number {
  switch (key) {
    case "id":
      return m.species;
    case "name":
      return 0;
    case "bst":
      return m.bst;
    case "hp":
      return m.stats[0];
    case "atk":
      return m.stats[1];
    case "def":
      return m.stats[2];
    case "spa":
      return m.stats[3];
    case "spd":
      return m.stats[4];
    case "spe":
      return m.stats[5];
    default:
      return roleScore(m.stats, ROLES.find((r) => r.key === key)!);
  }
}

export function matchesView(m: LabMon, v: Pick<LabView, "types" | "gens" | "legends" | "final" | "forms">): boolean {
  if (m.isForm && !v.forms) return false;
  if (v.types.length && !v.types.every((t) => m.types.includes(t))) return false;
  if (v.gens.length && !v.gens.includes(m.gen)) return false;
  if (v.legends && !(m.legendary || m.mythical)) return false;
  if (v.final && !m.fullyEvolved) return false;
  return true;
}

/** Ties (and the number order) keep a species before its forms, forms in id order. */
function byNumber(a: LabMon, b: LabMon): number {
  return a.species - b.species || Number(a.isForm) - Number(b.isForm) || a.id - b.id;
}

/** The filtered, sorted list (indexes into `all`). */
export function buildSequence(all: readonly LabMon[], v: LabView): number[] {
  const idx: number[] = [];
  for (let i = 0; i < all.length; i++) if (matchesView(all[i], v)) idx.push(i);
  const natural = ASCENDING_FIRST.includes(v.sort) ? 1 : -1;
  const dir = v.reverse ? -natural : natural;
  if (v.sort === "name") {
    idx.sort((a, b) => all[a].name.localeCompare(all[b].name, "en") * dir || byNumber(all[a], all[b]));
  } else {
    const vals = new Map(idx.map((i) => [i, sortValue(all[i], v.sort)]));
    idx.sort((a, b) => (vals.get(a)! - vals.get(b)!) * dir || byNumber(all[a], all[b]));
  }
  return idx;
}

/**
 * Where typing should take the wheel: positions in the sequence, best match
 * first (an exact number or name, names starting with it, a later word
 * starting with it, names containing it, then categories).
 */
export function searchSequence(all: readonly LabMon[], seq: readonly number[], query: string, limit = 6): number[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const out: number[][] = [[], [], [], [], []];
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    seq.forEach((i, pos) => {
      const m = all[i];
      if (m.species === n) out[m.isForm ? 1 : 0].push(pos);
      else if (matchesDexQuery({ id: m.species, name: m.name, genus: m.genus }, trimmed)) out[2].push(pos);
    });
    for (const t of out) t.sort((a, b) => byNumber(all[seq[a]], all[seq[b]]));
    return out.flat().slice(0, limit);
  }
  const q = normalizeDexQuery(trimmed);
  if (!q) return [];
  seq.forEach((i, pos) => {
    const m = all[i];
    const name = normalizeDexQuery(m.name);
    const words = m.name.split(/[\s\-.:]+/).filter(Boolean).slice(1).map(normalizeDexQuery);
    if (name === q) out[0].push(pos);
    else if (name.startsWith(q)) out[1].push(pos);
    else if (words.some((w) => w.startsWith(q))) out[2].push(pos);
    else if (name.includes(q)) out[3].push(pos);
    else if (normalizeDexQuery(m.genus).includes(q)) out[4].push(pos);
  });
  // Within a tier, species before forms, then by number (Charizard before Mega Charizard X).
  for (const t of out) t.sort((a, b) => byNumber(all[seq[a]], all[seq[b]]));
  return out.flat().slice(0, limit);
}

// ---- URL ---------------------------------------------------------------------

export function viewFromParams(q: URLSearchParams): LabView {
  const types = (q.get("type") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t, i, a) => (TYPES as readonly string[]).includes(t) && a.indexOf(t) === i)
    .slice(0, 2);
  const gens = (q.get("gen") ?? "")
    .split(",")
    .map(Number)
    .filter((g, i, a) => Number.isInteger(g) && g >= 1 && g <= 9 && a.indexOf(g) === i)
    .sort((a, b) => a - b);
  const sort = PARAM_SORT.get(q.get("sort") ?? "") ?? "id";
  const natural = ASCENDING_FIRST.includes(sort) ? "asc" : "desc";
  const dir = q.get("dir");
  return {
    types,
    gens,
    legends: q.get("legend") === "1",
    final: q.get("final") === "1",
    forms: q.get("forms") === "1",
    sort,
    reverse: dir === "asc" || dir === "desc" ? dir !== natural : false,
  };
}

/** The query string for a view and the Pokémon on the table (defaults left out, so the plain URL stays plain). */
export function viewToParams(v: LabView, pick: number | null): URLSearchParams {
  const q = new URLSearchParams();
  if (pick != null) q.set("pick", String(pick));
  if (v.types.length) q.set("type", v.types.join(","));
  if (v.gens.length) q.set("gen", v.gens.join(","));
  if (v.legends) q.set("legend", "1");
  if (v.final) q.set("final", "1");
  if (v.forms) q.set("forms", "1");
  if (v.sort !== "id") q.set("sort", SORT_PARAM[v.sort]);
  if (v.reverse) {
    const natural = ASCENDING_FIRST.includes(v.sort) ? "asc" : "desc";
    q.set("dir", natural === "asc" ? "desc" : "asc");
  }
  return q;
}

export function sameView(a: LabView, b: LabView): boolean {
  return (
    a.types.join() === b.types.join() &&
    a.gens.join() === b.gens.join() &&
    a.legends === b.legends &&
    a.final === b.final &&
    a.forms === b.forms &&
    a.sort === b.sort &&
    a.reverse === b.reverse
  );
}

/** The value a sort shows on a Pokémon (null for number / name). */
export function sortBadge(m: LabMon, key: SortKey): number | null {
  if (key === "id" || key === "name") return null;
  return sortValue(m, key);
}
