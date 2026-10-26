import "server-only";
import type { TcgCard, TcgSet } from "./types";

/**
 * Pokémon TCG API client (https://api.pokemontcg.io/v2). Works without a key;
 * POKEMONTCG_API_KEY raises the rate limit when set.
 *
 * Every response goes through Next's data cache: sets for a week, cards (and
 * so their prices, which the API refreshes about daily) for a day. A failed
 * call is never cached; callers get `null` and show an "unavailable" note.
 *
 * POKEIQ_TCG_FIXTURE=1 serves a small captured slice of real API data instead
 * (tests, offline e2e).
 */

const BASE = "https://api.pokemontcg.io/v2";
const DAY = 60 * 60 * 24;
export const SETS_REVALIDATE = DAY * 7;
export const CARDS_REVALIDATE = DAY;
const LIST_FIELDS = "id,name,number,rarity,types,supertype,images,set,tcgplayer,cardmarket,nationalPokedexNumbers";

const fixtureMode = () => process.env.POKEIQ_TCG_FIXTURE === "1";

async function fixture(): Promise<{ sets: TcgSet[]; cards: TcgCard[] }> {
  return (await import("./fixture.json")).default as unknown as { sets: TcgSet[]; cards: TcgCard[] };
}

interface Page<T> {
  data: T;
  totalCount?: number;
}

async function get<T>(path: string, revalidate: number): Promise<Page<T> | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  // The API answers with the odd 500/502 under load: try a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers, next: { revalidate, tags: ["tcg"] }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as Page<T>;
    } catch {
      // Network error or timeout: retry.
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
}

/** Strip everything but name characters, so a search can't inject query syntax. */
export function cleanSearch(q: string): string {
  return q
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} '.&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export async function getSets(): Promise<TcgSet[] | null> {
  if (fixtureMode()) return (await fixture()).sets;
  const res = await get<TcgSet[]>("/sets?orderBy=-releaseDate&pageSize=250", SETS_REVALIDATE);
  return res?.data ?? null;
}

export async function getSet(id: string): Promise<TcgSet | null> {
  if (fixtureMode()) return (await fixture()).sets.find((s) => s.id === id) ?? null;
  if (!/^[a-z0-9.-]+$/i.test(id)) return null;
  const res = await get<TcgSet>(`/sets/${encodeURIComponent(id)}`, SETS_REVALIDATE);
  return res?.data ?? null;
}

/** Every card in a set (the API pages at 250). */
export async function getSetCards(setId: string): Promise<TcgCard[] | null> {
  if (fixtureMode()) return (await fixture()).cards.filter((c) => c.set?.id === setId);
  if (!/^[a-z0-9.-]+$/i.test(setId)) return null;
  const all: TcgCard[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await get<TcgCard[]>(`/cards?q=set.id:${encodeURIComponent(setId)}&orderBy=number&pageSize=250&page=${page}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
    if (!res) return all.length ? all : null;
    all.push(...res.data);
    if (res.data.length < 250 || all.length >= (res.totalCount ?? 0)) break;
  }
  return all;
}

export async function getCard(id: string): Promise<TcgCard | null> {
  if (fixtureMode()) return (await fixture()).cards.find((c) => c.id === id) ?? null;
  if (!/^[a-z0-9.-]+$/i.test(id)) return null;
  const res = await get<TcgCard>(`/cards/${encodeURIComponent(id)}`, CARDS_REVALIDATE);
  return res?.data ?? null;
}

const newestFirst = (a: TcgCard, b: TcgCard) => (b.set?.releaseDate ?? "").localeCompare(a.set?.releaseDate ?? "");

/** Cards whose name starts with (each word of) `q`, newest first. */
export async function searchCards(q: string, limit = 60): Promise<TcgCard[] | null> {
  const term = cleanSearch(q);
  if (!term) return [];
  if (fixtureMode()) {
    const t = term.toLowerCase();
    return (await fixture()).cards.filter((c) => c.name.toLowerCase().includes(t)).sort(newestFirst).slice(0, limit);
  }
  const query = encodeURIComponent(`name:"${term}*"`);
  const res = await get<TcgCard[]>(`/cards?q=${query}&orderBy=-set.releaseDate&pageSize=${limit}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
  return res?.data ?? null;
}

/** A species' cards by National Pokédex number, newest first, with the total count. */
export async function cardsForDex(dex: number, limit: number): Promise<{ cards: TcgCard[]; total: number } | null> {
  if (!Number.isInteger(dex) || dex < 1 || dex > 2000) return null;
  if (fixtureMode()) {
    const cards = (await fixture()).cards.filter((c) => c.nationalPokedexNumbers?.includes(dex)).sort(newestFirst);
    return { cards: cards.slice(0, limit), total: cards.length };
  }
  const res = await get<TcgCard[]>(`/cards?q=nationalPokedexNumbers:${dex}&orderBy=-set.releaseDate&pageSize=${limit}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
  return res ? { cards: res.data, total: res.totalCount ?? res.data.length } : null;
}
