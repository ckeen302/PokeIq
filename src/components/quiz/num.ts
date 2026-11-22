import { formatNumber } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";

/**
 * A score as the quiz screens always showed it in English (`toLocaleString()`, the browser's own grouping), and as
 * the page's language writes numbers anywhere else.
 */
export function num(n: number, locale: Locale): string {
  return locale === "en" ? n.toLocaleString() : formatNumber(n, locale);
}
