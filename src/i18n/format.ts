import type { Locale } from "./config";

/**
 * The languages' Intl locales and numbers in them, apart from the translator (i18n/catalog re-exports both): a page
 * that only formats a number or picks an Intl locale needn't carry the translator.
 */

export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", ja: "ja-JP", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" };

const formats = new Map<string, Intl.NumberFormat>();

/** A number as the language writes it ("1,234" / "1.234" / "1 234"). English keeps the site's en-US. */
export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  const key = `${locale}${opts ? JSON.stringify(opts) : ""}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.NumberFormat(INTL_LOCALE[locale], opts)));
  return f.format(n);
}
