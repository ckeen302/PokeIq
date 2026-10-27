import "server-only";
import type { TcgCard, TcgSet } from "./types";
import { fallbackCard, fallbackForDex, fallbackSearch, fallbackSet, fallbackSetCards, fallbackSets } from "./fallback";
import { withCardPrices, withPrices } from "./price-provider";

/**
 * Pokémon TCG API client (https://api.pokemontcg.io/v2). Works without a key;
 * POKEMONTCG_API_KEY raises the rate limit when set.
 *
 * Every response goes through Next's data cache: sets for a week, cards (and
 * so their prices, which the API refreshes about daily) for a day. A failed
 * call is never cached; callers get `null` and show an "unavailable" note.
 *
 * When the API errors or takes over ~4s, everything falls back to the static
 * pokemon-tcg-data dataset (see ./fallback): same data, no prices.
 *
 * Cards without API prices get them from ./price-provider (TCGplayer via
 * TCGCSV, Cardmarket via TCGdex on card pages). Lists that span many sets
 * wait at most LIST_PRICE_BUDGET_MS for those.
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
const LIST_PRICE_BUDGET_MS = 2_500;
const priced = (cards: TcgCard[] | null) => (cards ? withPrices(cards) : null);
const pricedList = (cards: TcgCard[] | null) => (cards ? withPrices(cards, { budgetMs: LIST_PRICE_BUDGET_MS }) : null);

async function fixture(): Promise<{ sets: TcgSet[]; cards: TcgCard[] }> {
  return (await import("./fixture.json")).default as unknown as { sets: TcgSet[]; cards: TcgCard[] };
}

interface Page<T> {
  data: T;
  totalCount?: number;
}

/** After a failed API call, skip straight to the static fallback for a while. */
const API_COOLDOWN_MS = 60_000;
let apiDownUntil = 0;
export function resetApiHealth() {
  apiDownUntil = 0;
}

/**
 * One short attempt (~4s) against the API. `undefined` = the API is down or
 * erroring (use the fallback); `null` = a definite 404.
 */
async function get<T>(path: string, revalidate: number): Promise<Page<T> | null | undefined> {
  if (Date.now() < apiDownUntil) return undefined;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  try {
    const res = await fetch(`${BASE}${path}`, { headers, next: { revalidate, tags: ["tcg"] }, signal: AbortSignal.timeout(4_000) });
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as Page<T>;
  } catch {
    // Network error or timeout.
  }
  apiDownUntil = Date.now() + API_COOLDOWN_MS;
  return undefined;
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
  return res ? res.data : fallbackSets();
}

export async function getSet(id: string): Promise<TcgSet | null> {
  if (fixtureMode()) return (await fixture()).sets.find((s) => s.id === id) ?? null;
  if (!/^[a-z0-9.-]+$/i.test(id)) return null;
  const res = await get<TcgSet>(`/sets/${encodeURIComponent(id)}`, SETS_REVALIDATE);
  return res ? res.data : fallbackSet(id);
}

/** Every card in a set (the API pages at 250). */
export async function getSetCards(setId: string): Promise<TcgCard[] | null> {
  return priced(await setCards(setId));
}

async function setCards(setId: string): Promise<TcgCard[] | null> {
  if (fixtureMode()) return (await fixture()).cards.filter((c) => c.set?.id === setId);
  if (!/^[a-z0-9.-]+$/i.test(setId)) return null;
  const all: TcgCard[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await get<TcgCard[]>(`/cards?q=set.id:${encodeURIComponent(setId)}&orderBy=number&pageSize=250&page=${page}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
    if (res === undefined) return fallbackSetCards(setId);
    if (!res) return all.length ? all : null;
    all.push(...res.data);
    if (res.data.length < 250 || all.length >= (res.totalCount ?? 0)) break;
  }
  return all;
}

export async function getCard(id: string): Promise<TcgCard | null> {
  const card = await getCardInfo(id);
  return card ? withCardPrices(card) : null;
}

/** A card without the price lookups (for callers that only need its name, set and image). */
export async function getCardInfo(id: string): Promise<TcgCard | null> {
  if (fixtureMode()) return (await fixture()).cards.find((c) => c.id === id) ?? null;
  if (!/^[a-z0-9.-]+$/i.test(id)) return null;
  const res = await get<TcgCard>(`/cards/${encodeURIComponent(id)}`, CARDS_REVALIDATE);
  if (res === undefined) return fallbackCard(id);
  return res?.data ?? null;
}

const newestFirst = (a: TcgCard, b: TcgCard) => (b.set?.releaseDate ?? "").localeCompare(a.set?.releaseDate ?? "");

/** Cards whose name starts with (each word of) `q`, newest first. */
export async function searchCards(q: string, limit = 60): Promise<TcgCard[] | null> {
  return pricedList(await findCards(q, limit));
}

async function findCards(q: string, limit: number): Promise<TcgCard[] | null> {
  const term = cleanSearch(q);
  if (!term) return [];
  if (fixtureMode()) {
    const t = term.toLowerCase();
    return (await fixture()).cards.filter((c) => c.name.toLowerCase().includes(t)).sort(newestFirst).slice(0, limit);
  }
  const query = encodeURIComponent(`name:"${term}*"`);
  const res = await get<TcgCard[]>(`/cards?q=${query}&orderBy=-set.releaseDate&pageSize=${limit}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
  if (res === undefined) return fallbackSearch(term, limit);
  return res?.data ?? [];
}

/** A species' cards by National Pokédex number, newest first, with the total count. */
export async function cardsForDex(dex: number, limit: number): Promise<{ cards: TcgCard[]; total: number } | null> {
  const res = await dexCards(dex, limit);
  return res && { cards: (await pricedList(res.cards))!, total: res.total };
}

async function dexCards(dex: number, limit: number): Promise<{ cards: TcgCard[]; total: number } | null> {
  if (!Number.isInteger(dex) || dex < 1 || dex > 2000) return null;
  if (fixtureMode()) {
    const cards = (await fixture()).cards.filter((c) => c.nationalPokedexNumbers?.includes(dex)).sort(newestFirst);
    return { cards: cards.slice(0, limit), total: cards.length };
  }
  const res = await get<TcgCard[]>(`/cards?q=nationalPokedexNumbers:${dex}&orderBy=-set.releaseDate&pageSize=${limit}&select=${LIST_FIELDS}`, CARDS_REVALIDATE);
  if (res === undefined) return fallbackForDex(dex, limit);
  return res ? { cards: res.data, total: res.totalCount ?? res.data.length } : null;
}
