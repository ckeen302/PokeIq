import "server-only";
import { pdkStore } from "./pikadoku-board";

/**
 * How often each Pokémon is picked across a recent day's Normal grid
 * (percent of players' answers), for Tic Tac Toe's Steals mode: a lower pick
 * rate is rarer. Null when there is too little recorded data (the store is
 * off, or the day was quiet), and then any different valid Pokémon steals.
 */
const MIN_ANSWERS = 30;
const TTL_MS = 10 * 60_000;
let cache: { at: number; rates: Map<number, number> | null } | null = null;

export function ratesFromCounts(picks: Map<number, number>[], totals: number[]): Map<number, number> | null {
  const all = totals.reduce((a, b) => a + b, 0);
  if (all < MIN_ANSWERS) return null;
  const sum = new Map<number, number>();
  for (const m of picks) for (const [id, n] of m) sum.set(id, (sum.get(id) ?? 0) + n);
  return new Map([...sum].map(([id, n]) => [id, Math.round((n / all) * 10_000) / 100]));
}

export async function pdkPickRates(now = Date.now()): Promise<Map<number, number> | null> {
  if (cache && now - cache.at < TTL_MS) return cache.rates;
  const db = pdkStore();
  let rates: Map<number, number> | null = null;
  if (db) {
    const day = new Date(now - 86_400_000).toISOString().slice(0, 10);
    const counts = await db.counts(day, "normal").catch(() => null);
    rates = counts ? ratesFromCounts(counts.picks, counts.totals) : null;
  }
  cache = { at: now, rates };
  return rates;
}
