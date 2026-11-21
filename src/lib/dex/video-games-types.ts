/**
 * The Games tab: every Pokémon video game, its box art and what the Pokédex
 * has on it. Client safe: types and the list's filter / sort live here, the
 * data (src/lib/dex/video-games.ts) stays on the server pages.
 */

export type GameKind = "mainline" | "remake" | "spinoff" | "mobile";

export const KIND_LABEL: Record<GameKind, string> = {
  mainline: "Mainline",
  remake: "Remake",
  spinoff: "Spin-off",
  mobile: "Mobile",
};

/** The list's filter chips, in order ("all" first). */
export const KIND_FILTERS = [
  { id: "all", label: "All" },
  { id: "mainline", label: "Mainline" },
  { id: "remake", label: "Remakes" },
  { id: "spinoff", label: "Spin-offs" },
  { id: "mobile", label: "Mobile" },
] as const;
export type KindFilter = (typeof KIND_FILTERS)[number]["id"];

export const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type GameSort = "newest" | "oldest";
export const SORTS: { id: GameSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
];

/** What a card in the list needs (and all the list ships to the browser). */
export interface GameCard {
  slug: string;
  name: string;
  kind: GameKind;
  gen: number;
  /** First release, ISO ("1996-02-27", or "2008-03" when only the month is certain). */
  released: string;
  /** Short platform label for the card ("Switch", "GBA"). */
  platform: string;
  cover: CoverArt;
}

/** Box art: one or two covers in public/games, or (a mobile game without a box) a Pokémon's artwork on a coloured tile. */
export type CoverArt =
  | { kind: "box"; files: [string] | [string, string]; alts: [string] | [string, string] }
  | { kind: "art"; id: number; alt: string; /** The Pokémon's types, for the tile's colours. */ types: string[] };

export interface GameQuery {
  kind: KindFilter;
  gen: number | null;
  sort: GameSort;
}

export const DEFAULT_QUERY: GameQuery = { kind: "all", gen: null, sort: "newest" };

/** The list's state from its URL query (`?kind=remake&gen=3&sort=oldest`); anything unknown falls back to the default. */
export function parseGameQuery(params: URLSearchParams | Record<string, string | undefined>): GameQuery {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]) ?? undefined;
  const kind = KIND_FILTERS.find((f) => f.id === get("kind"))?.id ?? "all";
  const g = Number(get("gen"));
  const gen = (GENS as readonly number[]).includes(g) ? g : null;
  const sort: GameSort = get("sort") === "oldest" ? "oldest" : "newest";
  return { kind, gen, sort };
}

/** The query string for a state, without the defaults ("" for the plain list). */
export function gameQueryString(q: GameQuery): string {
  const p = new URLSearchParams();
  if (q.kind !== "all") p.set("kind", q.kind);
  if (q.gen !== null) p.set("gen", String(q.gen));
  if (q.sort !== "newest") p.set("sort", q.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The games a state shows, in its order (release date, then name). */
export function applyGameQuery<T extends Pick<GameCard, "kind" | "gen" | "released" | "name">>(games: readonly T[], q: GameQuery): T[] {
  const dir = q.sort === "oldest" ? 1 : -1;
  return games
    .filter((g) => (q.kind === "all" || g.kind === q.kind) && (q.gen === null || g.gen === q.gen))
    .sort((a, b) => dir * a.released.localeCompare(b.released) || a.name.localeCompare(b.name));
}

export const releaseYear = (released: string) => Number(released.slice(0, 4));
