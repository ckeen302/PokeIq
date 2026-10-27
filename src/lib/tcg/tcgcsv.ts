import "server-only";
import { guessGroup, type SetLike, type TcgcsvGroup, type TcgcsvProduct } from "./price-match";
import { parseTcgcsvPrices, parseTcgcsvProducts, toApiDate, type TcgcsvPriceMap } from "./tcgcsv-parse";
import priceSets from "./price-sets.json";

/**
 * TCGplayer prices via TCGCSV (tcgcsv.com), a free daily mirror of TCGplayer's
 * API. Following its usage guidelines (tcgcsv.com/docs):
 * - server side only (it blocks browsers with CORS anyway), never per visitor:
 *   every response goes through Next's data cache — prices for 12 h, product
 *   lists and the group list for 24 h (TCGCSV rebuilds once a day, ~20:00 UTC);
 * - lazily, one set (group) at a time, only when a page needs it;
 * - an identifying User-Agent and at least 100 ms between requests from one
 *   server instance.
 * A failed request is never cached; callers treat it as "prices unknown".
 *
 * POKEIQ_TCG_FIXTURE=1 reads captured responses from price-fixture.json instead.
 */

const BASE = "https://tcgcsv.com/tcgplayer/3"; // category 3 = Pokémon
export const USER_AGENT = "PokeIQ/1.0 (+https://pokeiq.vercel.app; TCG card prices)";
const HOUR = 60 * 60;
export const PRICES_REVALIDATE = 12 * HOUR;
const PRODUCTS_REVALIDATE = 24 * HOUR;
const MIN_GAP_MS = 100;

const fixtureMode = () => process.env.POKEIQ_TCG_FIXTURE === "1";

export interface PriceSetEntry {
  tcgplayer: number[];
  tcgdex: string | null;
  promo?: true;
}
const TABLE = (priceSets as unknown as { sets: Record<string, PriceSetEntry> }).sets;

export function priceSetEntry(setId: string): PriceSetEntry | undefined {
  return Object.prototype.hasOwnProperty.call(TABLE, setId) ? TABLE[setId] : undefined;
}

let nextSlot = 0;
/** Spaces request starts ≥100 ms apart (cache hits included: cheap, and simpler than guessing). */
async function politeFetch(url: string, revalidate: number): Promise<Response | null> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate, tags: ["tcg", "tcg-prices"] },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** In-process memo on top of the data cache, so a warm server parses each file once per TTL. Failures aren't kept. */
const memo = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
function remember<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.value as Promise<T | null>;
  const value = load().then((v) => {
    if (v === null) memo.delete(key);
    return v;
  });
  memo.set(key, { at: Date.now(), ttl: ttlSeconds, value });
  if (memo.size > 400) memo.delete(memo.keys().next().value!);
  return value;
}
export function resetTcgcsvMemo() {
  memo.clear();
  nextSlot = 0;
}

export interface GroupPrices {
  groupId: number;
  products: TcgcsvProduct[];
  prices: TcgcsvPriceMap;
  /** "YYYY/MM/DD": when TCGCSV published these prices. */
  updatedAt: string | null;
}

interface FixtureFile {
  groups: Record<string, { updatedAt: string; products: unknown; prices: unknown }>;
  groupList: TcgcsvGroup[];
  tcgdex: Record<string, unknown>;
}
let fixturePromise: Promise<FixtureFile> | null = null;
export function priceFixture(): Promise<FixtureFile> {
  fixturePromise ??= import("./price-fixture.json").then((m) => m.default as unknown as FixtureFile);
  return fixturePromise;
}

/** One TCGplayer group's single cards and their current prices, or null when TCGCSV can't be reached. */
export function groupPrices(groupId: number): Promise<GroupPrices | null> {
  if (!Number.isInteger(groupId) || groupId <= 0) return Promise.resolve(null);
  return remember(`group:${groupId}`, PRICES_REVALIDATE, async () => {
    if (fixtureMode()) {
      const g = (await priceFixture()).groups[groupId];
      return g ? { groupId, products: parseTcgcsvProducts(g.products), prices: parseTcgcsvPrices(g.prices), updatedAt: g.updatedAt } : null;
    }
    const [productsRes, pricesRes] = await Promise.all([
      politeFetch(`${BASE}/${groupId}/products`, PRODUCTS_REVALIDATE),
      politeFetch(`${BASE}/${groupId}/prices`, PRICES_REVALIDATE),
    ]);
    if (!productsRes || !pricesRes) return null;
    try {
      const [products, prices] = await Promise.all([productsRes.json(), pricesRes.json()]);
      return {
        groupId,
        products: parseTcgcsvProducts(products),
        prices: parseTcgcsvPrices(prices),
        updatedAt: toApiDate(pricesRes.headers.get("last-modified")) ?? (await lastUpdated()),
      };
    } catch {
      return null;
    }
  });
}

/** TCGCSV's last build time ("YYYY/MM/DD"), for when a prices file comes without Last-Modified. */
function lastUpdated(): Promise<string | null> {
  return remember("last-updated", PRICES_REVALIDATE, async () => {
    const res = await politeFetch("https://tcgcsv.com/last-updated.txt", PRICES_REVALIDATE);
    return res ? toApiDate((await res.text()).trim()) : null;
  });
}

function groupList(): Promise<TcgcsvGroup[] | null> {
  return remember("groups", PRODUCTS_REVALIDATE, async () => {
    if (fixtureMode()) return (await priceFixture()).groupList;
    const res = await politeFetch(`${BASE}/groups`, PRODUCTS_REVALIDATE);
    if (!res) return null;
    const raw = (await res.json().catch(() => null)) as { results?: TcgcsvGroup[] } | null;
    return Array.isArray(raw?.results) ? raw.results : null;
  });
}

/**
 * TCGplayer group ids for one of our sets: the committed table, else (a set
 * newer than the table) a strict name/code + release-date guess against
 * TCGCSV's group list. Empty when there's no confident answer.
 */
export async function groupsForSet(set: SetLike): Promise<number[]> {
  const entry = priceSetEntry(set.id);
  if (entry) return entry.tcgplayer;
  const groups = await groupList();
  const id = groups ? guessGroup(set, groups) : null;
  return id ? [id] : [];
}
