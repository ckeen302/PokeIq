import "server-only";
import type { Locale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import ja from "@/data/i18n/ja/content/timeline.json";
import es from "@/data/i18n/es/content/timeline.json";
import fr from "@/data/i18n/fr/content/timeline.json";
import de from "@/data/i18n/de/content/timeline.json";
import it from "@/data/i18n/it/content/timeline.json";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";
import { TIMELINE } from "./data";
import type { TimelineEntry, TimelineSpecies } from "./types";

/**
 * The timeline in another language, for the server: each entry's title, note, Japanese series name and platform
 * from src/data/i18n/<locale>/content/timeline.json (keyed by entry id), its region's official name, and its
 * species' official names. English is the timeline itself, untouched.
 */

export interface TimelineContent {
  /** Every entry id: its title, and its note and Japanese series name where the English has one. */
  entries: Record<string, { title: string; note?: string; series?: string }>;
  /** Every platform but the card game's series lines, by its English text. */
  platforms: Record<string, string>;
  /** "Trading Card Game · <series>": the card game's name and each series' name. */
  tcg: { name: string; series: Record<string, string> };
  /** Regions the language's regions.json lacks (Kitakami). */
  regions: Record<string, string>;
}

export const TIMELINE_CONTENT: Record<Exclude<Locale, "en">, TimelineContent> = { ja, es, fr, de, it };
const REGIONS: Record<Exclude<Locale, "en">, Record<string, string>> = { ja: jaRegions, es: esRegions, fr: frRegions, de: deRegions, it: itRegions };

const TCG = "Trading Card Game · ";

/** A platform line in the language, and (card game series) its short form for the compact rows. */
export function localPlatform(c: TimelineContent, platform: string): { full: string; short?: string } {
  if (platform.startsWith(TCG)) {
    const series = platform.slice(TCG.length);
    const own = c.tcg.series[series] ?? series;
    return { full: `${c.tcg.name} · ${own}`, short: own };
  }
  return { full: c.platforms[platform] ?? platform };
}

const cache = new Map<Locale, TimelineEntry[]>();

/** The timeline's entries in the language (the same list, in the same order). */
export function localTimeline(locale: Locale): TimelineEntry[] {
  if (locale === "en") return TIMELINE;
  const hit = cache.get(locale);
  if (hit) return hit;
  const c = TIMELINE_CONTENT[locale];
  const regions = REGIONS[locale];
  const sp = (s: TimelineSpecies): TimelineSpecies => ({ ...s, name: speciesName(s.id, s.name, locale) });
  const list = TIMELINE.map((e): TimelineEntry => {
    const own = c.entries[e.id];
    const platform = localPlatform(c, e.platform);
    return {
      ...e,
      title: own?.title ?? e.title,
      note: e.note ? (own?.note ?? e.note) : null,
      series: e.series ? (own?.series ?? e.series) : null,
      platform: platform.full,
      ...(platform.short !== undefined && { platformShort: platform.short }),
      region: e.region ? (regions[e.region.toLowerCase()] ?? c.regions[e.region] ?? e.region) : null,
      starters: e.starters.map(sp),
      legendaries: e.legendaries.map(sp),
    };
  });
  cache.set(locale, list);
  return list;
}

/** One entry in the language. */
export function localEntry(id: string, locale: Locale): TimelineEntry | undefined {
  return localTimeline(locale).find((e) => e.id === id);
}
