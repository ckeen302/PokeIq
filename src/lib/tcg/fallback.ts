import "server-only";
import type { TcgCard, TcgSet } from "./types";

/**
 * Fallback for when api.pokemontcg.io is down: the official static dataset
 * (github.com/PokemonTCG/pokemon-tcg-data), same shapes minus prices.
 * Sets and per-set card files are fetched lazily and cached for a day; search
 * and per-species lookups use a precomputed compact index
 * (fallback-index.json, rebuilt with scripts/build-tcg-index.mjs).
 * Every card returned from here carries `pricesUnavailable: true`.
 */

const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const DAY = 60 * 60 * 24;
const SAFE_ID = /^[a-z0-9._-]+$/i;

/** [id, name, number, rarity | 0, kinds, dex numbers | 0, smallImage?] */
export type IndexRow = [string, string, string, string | 0, string[], number[] | 0, string?];

async function raw<T>(path: string): Promise<T | null> {
  try {
    // Card files can exceed Next's 2 MB data-cache item limit; the in-memory cache below covers that.
    const res = await fetch(`${RAW}/${path}`, { next: { revalidate: DAY, tags: ["tcg"] }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const memo = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < DAY * 1000) return hit.value as Promise<T | null>;
  const value = load().then((v) => {
    if (v === null) memo.delete(key); // never cache a failure
    return v;
  });
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 60) memo.delete(memo.keys().next().value!);
  return value;
}

const byNewest = (a: TcgSet, b: TcgSet) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");

export function fallbackSets(): Promise<TcgSet[] | null> {
  return cached("sets", async () => {
    const sets = await raw<(TcgSet & { updatedAt?: string; legalities?: unknown })[]>("sets/en.json");
    return sets ? sets.map(({ updatedAt: _u, legalities: _l, ...s }) => s as TcgSet).sort(byNewest) : null;
  });
}

async function setMap(): Promise<Map<string, TcgSet>> {
  return new Map((await fallbackSets())?.map((s) => [s.id, s]) ?? []);
}

export async function fallbackSet(id: string): Promise<TcgSet | null> {
  return (await setMap()).get(id) ?? null;
}

const byNumber = (a: TcgCard, b: TcgCard) => {
  const na = parseInt(a.number ?? "", 10);
  const nb = parseInt(b.number ?? "", 10);
  if (Number.isNaN(na) || Number.isNaN(nb) || na === nb) return (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });
  return na - nb;
};

export function fallbackSetCards(setId: string): Promise<TcgCard[] | null> {
  if (!SAFE_ID.test(setId)) return Promise.resolve(null);
  return cached(`cards:${setId}`, async () => {
    const [set, cards] = await Promise.all([fallbackSet(setId), raw<TcgCard[]>(`cards/en/${encodeURIComponent(setId)}.json`)]);
    if (!set || !cards) return null;
    return cards.map((c) => ({ ...c, set, pricesUnavailable: true })).sort(byNumber);
  });
}

/** Card ids are "<setId>-<number>"; set ids never contain a hyphen. */
export function setIdOf(cardId: string): string {
  const i = cardId.lastIndexOf("-");
  return i > 0 ? cardId.slice(0, i) : cardId;
}

export async function fallbackCard(id: string): Promise<TcgCard | null> {
  if (!SAFE_ID.test(id)) return null;
  return (await fallbackSetCards(setIdOf(id)))?.find((c) => c.id === id) ?? null;
}

let indexPromise: Promise<IndexRow[]> | null = null;
export function loadIndex(): Promise<IndexRow[]> {
  indexPromise ??= import("./fallback-index.json").then((m) => (m.default as unknown as { cards: IndexRow[] }).cards);
  return indexPromise;
}

/** An index row as a list-shaped card (what tiles need), with its set attached. */
export function rowToCard(row: IndexRow, sets: Map<string, TcgSet>): TcgCard {
  const [id, name, number, rarity, kinds, dex, image] = row;
  const setId = setIdOf(id);
  const small = image ?? `https://images.pokemontcg.io/${setId}/${number}.png`;
  const isPokemon = kinds.length > 0 && kinds[0] !== "Trainer" && kinds[0] !== "Energy";
  return {
    id,
    name,
    number,
    ...(rarity ? { rarity } : {}),
    ...(isPokemon ? { types: kinds, supertype: "Pokémon" } : { supertype: kinds[0] }),
    ...(dex ? { nationalPokedexNumbers: dex } : {}),
    images: { small, large: small.replace(/\.png$/, "_hires.png") },
    set: sets.get(setId) ?? { id: setId, name: setId, series: "" },
    pricesUnavailable: true,
  };
}

const newestFirst = (a: TcgCard, b: TcgCard) => (b.set?.releaseDate ?? "").localeCompare(a.set?.releaseDate ?? "") || byNumber(a, b);

/** Name search: every word of `term` must prefix a word of the card name. Newest first. */
export async function fallbackSearch(term: string, limit: number): Promise<TcgCard[] | null> {
  const words = term.toLowerCase().split(" ").filter(Boolean);
  if (!words.length) return [];
  const [rows, sets] = await Promise.all([loadIndex(), setMap()]);
  if (!sets.size) return null;
  const hits = rows.filter((r) => {
    const name = r[1].toLowerCase();
    const nameWords = name.split(/[\s-]+/);
    return words.every((w) => name.startsWith(w) || nameWords.some((n) => n.startsWith(w)));
  });
  return hits.map((r) => rowToCard(r, sets)).sort(newestFirst).slice(0, limit);
}

export async function fallbackForDex(dex: number, limit: number): Promise<{ cards: TcgCard[]; total: number } | null> {
  const [rows, sets] = await Promise.all([loadIndex(), setMap()]);
  if (!sets.size) return null;
  const cards = rows.filter((r) => r[5] && r[5].includes(dex)).map((r) => rowToCard(r, sets)).sort(newestFirst);
  return { cards: cards.slice(0, limit), total: cards.length };
}
