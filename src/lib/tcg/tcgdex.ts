import "server-only";
import { parseTcgdexCard, type TcgdexCardPricing } from "./tcgdex-parse";
import { priceFixture, PRICES_REVALIDATE, USER_AGENT } from "./tcgcsv";

/**
 * Cardmarket (EUR) prices from TCGdex (tcgdex.dev), a free, open card API
 * whose card responses embed `pricing.cardmarket`. No key or published rate
 * limit; its FAQ asks for local caching, so each card is fetched server side
 * at most every 12 h (Next data cache) and only for a card's own page.
 */

const BASE = "https://api.tcgdex.net/v2/en";
const SAFE = /^[A-Za-z0-9.\-]+$/;

export async function tcgdexCard(tcgdexSetId: string, number: string): Promise<TcgdexCardPricing | null> {
  if (!SAFE.test(tcgdexSetId) || !SAFE.test(number)) return null;
  if (process.env.POKEIQ_TCG_FIXTURE === "1") {
    const raw = (await priceFixture()).tcgdex[`${tcgdexSetId}/${number}`];
    return raw ? parseTcgdexCard(raw) : null;
  }
  try {
    const res = await fetch(`${BASE}/sets/${encodeURIComponent(tcgdexSetId)}/${encodeURIComponent(number)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate: PRICES_REVALIDATE, tags: ["tcg", "tcg-prices"] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return parseTcgdexCard(await res.json());
  } catch {
    return null;
  }
}
