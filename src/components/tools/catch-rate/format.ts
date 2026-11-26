/** Numbers as the calculator shows them, in the page's language. */

const pctCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  let f = pctCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
    pctCache.set(key, f);
  }
  return f;
}

/**
 * A chance as a percentage: whole numbers in the middle, one decimal near 0 and 100 (so a 99.6% never reads as a
 * sure 100%), and "<0.1%" for the tiniest.
 */
export function pct(p: number, locale: string): string {
  if (p >= 1) return nf(locale, 0).format(1);
  if (p <= 0) return nf(locale, 0).format(0);
  if (p < 0.001) return `<${nf(locale, 1).format(0.001)}`;
  if (p < 0.1 || p >= 0.995) return nf(locale, 1).format(Math.min(p, 0.999));
  return nf(locale, 0).format(p);
}

/** An average number of throws: one decimal under 10, whole numbers above. */
export function throws(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
}
