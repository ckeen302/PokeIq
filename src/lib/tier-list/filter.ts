import { CAT, type Category, type FormKind, type Mon } from "./types";

/** The pool's search, filters and sort. */

export type FormFilter = "any" | "species" | FormKind;
export type SortKey = "dex" | "name" | "bst";

export interface PoolFilter {
  q: string;
  gen: number | null;
  type: string | null;
  form: FormFilter;
  cat: Category | null;
  sort: SortKey;
}

export const NO_FILTER: PoolFilter = { q: "", gen: null, type: null, form: "any", cat: null, sort: "dex" };

export const isFiltered = (f: PoolFilter) => !!(f.q.trim() || f.gen || f.type || f.form !== "any" || f.cat);

/** Lower case, no accents or punctuation: "Flabébé" and "flabebe", "Farfetch’d" and "farfetchd" match. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Whether a Pokémon matches a search: its name, or its National Dex number ("25", "#025"). */
export function matchesQuery(m: Mon, q: string): boolean {
  const t = q.trim();
  if (!t) return true;
  const num = /^#?0*(\d{1,4})$/.exec(t);
  if (num) return m.d === Number(num[1]);
  const f = fold(t);
  return !!f && fold(m.n).includes(f);
}

export function applyFilter(mons: readonly Mon[], f: PoolFilter): Mon[] {
  const out = mons.filter(
    (m) =>
      (!f.gen || m.g === f.gen) &&
      (!f.type || m.t.includes(f.type)) &&
      (f.form === "any" || (f.form === "species" ? !m.f : m.f === f.form)) &&
      (!f.cat || (m.c & CAT[f.cat]) !== 0) &&
      matchesQuery(m, f.q)
  );
  if (f.sort === "name") return out.sort((a, b) => a.n.localeCompare(b.n, "en"));
  if (f.sort === "bst") return out.sort((a, b) => b.b - a.b || a.d - b.d);
  return out;
}
