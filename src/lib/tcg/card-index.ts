import "server-only";
import setNames from "./set-names.json";
import { loadIndex, setIdOf, type IndexRow } from "./fallback";

/**
 * Offline lookups over the committed card index (fallback-index.json) and set
 * list (set-names.json), for crawlable links and the sitemap: no network, so
 * static pages and the sitemap never wait on the TCG API.
 */

const SETS = (setNames as unknown as { sets: Record<string, [string, string?]> }).sets;

export function setName(setId: string): string | undefined {
  return SETS[setId]?.[0];
}

/** Ids the card page accepts (two Unown cards, "ex10-!" and "ex10-?", are not addressable). */
const PAGE_ID = /^[a-z0-9._-]+$/i;

/** Every English card id in the index ("<set>-<number>") that has a card page, e.g. for the sitemap. */
export async function allCardIds(): Promise<string[]> {
  return (await loadIndex()).map((r) => r[0]).filter((id) => PAGE_ID.test(id));
}

/** Card URLs per sitemap file (the protocol's limit is 50,000). */
export const CARDS_PER_SITEMAP = 45_000;

/** The ids of the card sitemaps: /pokedex/tcg/sitemap/<id>.xml. */
export async function cardSitemapIds(): Promise<{ id: number }[]> {
  const count = Math.max(1, Math.ceil((await allCardIds()).length / CARDS_PER_SITEMAP));
  return Array.from({ length: count }, (_, id) => ({ id }));
}

export interface CardLink {
  id: string;
  name: string;
  number: string;
  setName: string;
}

const release = (r: IndexRow) => SETS[setIdOf(r[0])]?.[1] ?? "";
const num = (r: IndexRow) => parseInt(r[2], 10) || 0;

/** A species' cards, newest set first: `total` and up to `limit` links. */
export async function cardLinksForDex(dex: number, limit: number): Promise<{ cards: CardLink[]; total: number }> {
  const rows = (await loadIndex()).filter((r) => r[5] && r[5].includes(dex) && PAGE_ID.test(r[0]));
  rows.sort((a, b) => release(b).localeCompare(release(a)) || num(a) - num(b));
  return {
    total: rows.length,
    cards: rows.slice(0, limit).map((r) => ({ id: r[0], name: r[1], number: r[2], setName: setName(setIdOf(r[0])) ?? setIdOf(r[0]) })),
  };
}
