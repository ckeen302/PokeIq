import { variantKey, type TcgcsvProduct } from "./price-match";
import type { TcgPriceRow } from "./types";

/**
 * Parsers for TCGCSV (tcgcsv.com) responses: TCGplayer's own API output,
 * `{ success, errors, results: [...] }`. Anything malformed is skipped, never guessed.
 */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const results = (raw: unknown): unknown[] => {
  const r = (raw as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? r : [];
};

/** Single cards only (products with a collector number), trimmed to what matching needs. */
export function parseTcgcsvProducts(raw: unknown): TcgcsvProduct[] {
  return results(raw).flatMap((p) => {
    const x = (p ?? {}) as { productId?: unknown; name?: unknown; extendedData?: { name?: string; value?: unknown }[] };
    if (typeof x.productId !== "number" || typeof x.name !== "string") return [];
    const ext = (key: string) => {
      const v = x.extendedData?.find((e) => e?.name === key)?.value;
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const number = ext("Number");
    if (!number) return [];
    return [{ productId: x.productId, name: x.name, number, rarity: ext("Rarity") }];
  });
}

/** productId → variant key ("normal", "holofoil", "reverseHolofoil", …) → USD prices. Rows with no price at all are dropped. */
export type TcgcsvPriceMap = Record<number, Record<string, TcgPriceRow>>;

export function parseTcgcsvPrices(raw: unknown): TcgcsvPriceMap {
  const out: TcgcsvPriceMap = {};
  for (const p of results(raw)) {
    const x = (p ?? {}) as Record<string, unknown>;
    if (typeof x.productId !== "number" || typeof x.subTypeName !== "string" || !x.subTypeName) continue;
    const row: TcgPriceRow = { low: num(x.lowPrice), mid: num(x.midPrice), high: num(x.highPrice), market: num(x.marketPrice), directLow: num(x.directLowPrice) };
    if (row.low === null && row.mid === null && row.high === null && row.market === null) continue;
    (out[x.productId] ??= {})[variantKey(x.subTypeName)] = row;
  }
  return out;
}

/** An HTTP Last-Modified (or ISO) timestamp → "YYYY/MM/DD" (UTC), the date format prices.ts shows. */
export function toApiDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}
