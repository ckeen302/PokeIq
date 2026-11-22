/**
 * The site's languages. English is the default and lives at the root with every URL it has always had
 * (no /en/ prefix); the others live under their code (/es/pokemon/charizard), with English slugs inside.
 *
 * A language is only served when it is in LIVE_LOCALES (a comma list, read at build time; empty means English only).
 * A language that is not live returns 404 and is mentioned nowhere: no hreflang, no sitemap, no picker, no footer link.
 * Removing a code from LIVE_LOCALES (and redeploying) is the rollback.
 */
export const LOCALES = ["en", "ja", "es", "fr", "de", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export type OtherLocale = Exclude<Locale, "en">;
export const DEFAULT_LOCALE = "en" satisfies Locale;
export const OTHER_LOCALES = /*#__PURE__*/ LOCALES.filter((l): l is OtherLocale => l !== DEFAULT_LOCALE);

/** Each language in its own name, as the language picker lists it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
};

/** Open Graph's og:locale per language. */
export const OG_LOCALES: Record<Locale, string> = {
  en: "en_US",
  ja: "ja_JP",
  es: "es_ES",
  fr: "fr_FR",
  de: "de_DE",
  it: "it_IT",
};

/**
 * True once any language besides English is live. A plain comparison of the inlined value, so the minifier drops
 * everything behind it (the language picker, the suggestion banner) from English-only builds.
 */
export const HAS_OTHER_LOCALES = (process.env.LIVE_LOCALES ?? "") !== "";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The live languages other than English, in LOCALES order, from a LIVE_LOCALES value ("es,fr"). Unknown codes are ignored. */
export function parseLiveLocales(value: string | undefined): OtherLocale[] {
  const wanted = new Set((value ?? "").split(",").map((s) => s.trim().toLowerCase()));
  return OTHER_LOCALES.filter((l) => wanted.has(l));
}

/**
 * The live languages other than English. next.config inlines LIVE_LOCALES at build time (server and browser alike),
 * so a change takes a redeploy, like every static page that depends on it.
 */
export const LIVE_OTHER_LOCALES: readonly OtherLocale[] = /*#__PURE__*/ parseLiveLocales(process.env.LIVE_LOCALES);

/** Every live language, English first. */
export const LIVE_LOCALES: readonly Locale[] = /*#__PURE__*/ (() => [DEFAULT_LOCALE, ...LIVE_OTHER_LOCALES])();

export function isLiveLocale(value: unknown): value is Locale {
  return value === DEFAULT_LOCALE || (LIVE_OTHER_LOCALES as readonly unknown[]).includes(value);
}
