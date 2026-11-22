import "server-only";
import { INTL_LOCALE } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import type { CoverArt } from "./video-games-types";
import type { VideoGame } from "./video-games";

/**
 * The Games tab in another language: src/data/i18n/<locale>/content/games.json holds each game's translated text
 * (official titles, summary, what's new, DLC), keyed by slug, and the platform names. Loaded on the server for that
 * language only; English pages never load it and keep the English data exactly as it is.
 */

export interface GameText {
  name: string;
  summary: string;
  firstIn?: string;
  releasedAs?: string;
  region?: string;
  /** The box art's alt text, one per cover (the tile's Pokémon name for a phone app). */
  alts: string[];
  /** The two versions' names, for "Only in …". */
  versions?: [string, string];
  whatsNew?: { title: string; text: string }[];
  dlc?: { name: string; text: string }[];
}

export interface GameTexts {
  /** Platform names and short labels, keyed by the English ("Game Boy Color", "GBC"). */
  platforms: Record<string, string>;
  games: Record<string, GameText>;
}

const loaded = new Map<Locale, Promise<GameTexts>>();

/** A language's game texts (null for English). */
export function gameTexts(locale: Locale): Promise<GameTexts | null> {
  if (locale === "en") return Promise.resolve(null);
  let p = loaded.get(locale);
  if (!p) {
    p = import(`@/data/i18n/${locale}/content/games.json`).then((m: { default: GameTexts }) => m.default);
    loaded.set(locale, p);
  }
  return p;
}

/** A platform name in the language (as given when the language has none). */
export const localPlatform = (tx: GameTexts | null, p: string) => tx?.platforms[p] ?? p;

/** The game with its text in the language; English (no texts) comes back as it is. */
export function localizeGame(g: VideoGame, tx: GameTexts | null): VideoGame {
  const x = tx?.games[g.slug];
  if (!tx || !x) return g;
  const cover: CoverArt =
    g.cover.kind === "box"
      ? { ...g.cover, alts: g.cover.alts.map((a, i) => x.alts[i] ?? a) as typeof g.cover.alts }
      : { ...g.cover, alt: x.alts[0] ?? g.cover.alt };
  return {
    ...g,
    name: x.name,
    summary: x.summary,
    firstIn: g.firstIn && (x.firstIn ?? g.firstIn),
    releasedAs: g.releasedAs && (x.releasedAs ?? g.releasedAs),
    region: g.region && (x.region ?? g.region),
    platform: localPlatform(tx, g.platform),
    platforms: g.platforms.map((p) => localPlatform(tx, p)),
    cover,
    exclusives: g.exclusives && x.versions ? [{ ...g.exclusives[0], version: x.versions[0] }, { ...g.exclusives[1], version: x.versions[1] }] : g.exclusives,
    whatsNew: g.whatsNew?.map((n, i) => x.whatsNew?.[i] ?? n),
    dlc: g.dlc?.map((d, i) => ({ ...d, ...(x.dlc?.[i] ?? {}) })),
  };
}

/** "27 de febrero de 1996" (or the month alone when only the month is known), in the language. */
export function localRelease(released: string, locale: Locale): string {
  const [y, m, d] = released.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions = d ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } : { year: "numeric", month: "long", timeZone: "UTC" };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], opts).format(new Date(Date.UTC(y, m - 1, d || 1)));
}
