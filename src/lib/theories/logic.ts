import type { CaseSource, TheoryCase, Verdict } from "./types";

/**
 * Case of the week, filters and related cases. Client-safe and pure: the
 * weekly pick depends only on the date, so every visitor (and the cached
 * page) sees the same case all week, with no database.
 */

/** Monday 1 January 2024, 00:00 UTC: weeks run Monday to Sunday from here. */
const WEEK_EPOCH = Date.UTC(2024, 0, 1);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whole weeks since the epoch (negative before it). */
export function weekIndex(date: Date): number {
  return Math.floor((date.getTime() - WEEK_EPOCH) / WEEK_MS);
}

/** This week's featured case: the boarded cases take turns, one a week, in case-number order. */
export function caseOfTheWeek<T extends Pick<TheoryCase, "n" | "board">>(cases: readonly T[], date: Date): T & { board: NonNullable<T["board"]> } {
  const pool = cases.filter((c) => c.board).sort((a, b) => a.n - b.n);
  if (!pool.length) throw new Error("no case has board data");
  const i = ((weekIndex(date) % pool.length) + pool.length) % pool.length;
  return pool[i] as T & { board: NonNullable<T["board"]> };
}

export const VERDICTS: Verdict[] = ["confirmed", "fan", "debunked"];
export const SOURCE_ORDER: CaseSource[] = ["games", "anime", "pokedex", "internet", "manga"];

export interface CaseFilter {
  verdict: Verdict | null;
  sources: CaseSource[];
  q: string;
}

/** The filter in a URL query: ?v=fan&src=games,anime&q=gengar. Unknown values are ignored. */
export function parseFilter(params: { get(name: string): string | null }): CaseFilter {
  const v = params.get("v");
  const verdict = VERDICTS.includes(v as Verdict) ? (v as Verdict) : null;
  const sources = (params.get("src") ?? "")
    .split(",")
    .filter((x): x is CaseSource => SOURCE_ORDER.includes(x as CaseSource));
  return { verdict, sources: SOURCE_ORDER.filter((x) => sources.includes(x)), q: (params.get("q") ?? "").slice(0, 80) };
}

/** The query string for a filter ("" when nothing is filtered). */
export function filterQuery(f: CaseFilter): string {
  const p = new URLSearchParams();
  if (f.verdict) p.set("v", f.verdict);
  if (f.sources.length) p.set("src", f.sources.join(","));
  if (f.q.trim()) p.set("q", f.q.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase();

type Filterable = Pick<TheoryCase, "verdict" | "sources" | "title" | "summary" | "art" | "slug">;

/** Cases matching a filter: one verdict (or all), any of the chosen sources (or all), and every search word in the title, summary or a pictured Pokémon. */
export function filterCases<T extends Filterable>(cases: readonly T[], f: CaseFilter): T[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  return cases.filter((c) => {
    if (f.verdict && c.verdict !== f.verdict) return false;
    if (f.sources.length && !c.sources.some((x) => f.sources.includes(x))) return false;
    if (!words.length) return true;
    const hay = fold([c.title, c.summary, c.slug.replace(/-/g, " "), ...c.art.map((a) => a.name)].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** Up to `n` related cases: the case's own links first, then others with the same verdict. */
export function relatedCases(c: TheoryCase, all: readonly TheoryCase[], n = 3): TheoryCase[] {
  const out: TheoryCase[] = [];
  const add = (x: TheoryCase | undefined) => {
    if (x && x.slug !== c.slug && !out.includes(x) && out.length < n) out.push(x);
  };
  for (const slug of c.related ?? []) add(all.find((x) => x.slug === slug));
  for (const x of all) if (x.verdict === c.verdict) add(x);
  return out;
}

/** The folder's source line, e.g. "Pokédex · Games". */
export function sourceLine(c: Pick<TheoryCase, "sources">, labels: Record<CaseSource, string>): string {
  return c.sources.map((x) => labels[x]).join(" · ");
}
