import type { Translator } from "@/i18n/catalog";
import type { Insight } from "@/lib/coach";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
import coach from "@/messages/coach";

export type CoachT = Translator<typeof coach.en>;

/** Official names in the page's language (src/data/i18n), keyed as there: English lowercased, letters and digits only. */
export interface CoachNames {
  types: Record<string, string>;
  regions: Record<string, string>;
  stats: Record<string, string>;
}

const STAT_KEY: Record<string, string> = { hp: "hp", atk: "attack", def: "defense", spa: "specialattack", spd: "specialdefense", spe: "speed" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An insight's label and link text in the page's language. English (or no names sent): exactly as lib/coach wrote
 * them. A game mode keeps its title as the insight carries it.
 */
export function insightText(it: Insight, t: CoachT, names?: CoachNames): { label: string; cta: string } {
  if (t.locale === "en" || !names) return { label: it.label, cta: it.cta };
  const { kind, value } = it;
  if (kind === "gen") {
    const region = GENERATION_REGIONS[Number(value)] ?? "";
    return { label: t("gen", { gen: value, region: names.regions[region.toLowerCase()] ?? region }), cta: t("genCta", { gen: value }) };
  }
  if (kind === "type") {
    const type = names.types[value] ?? cap(value);
    return { label: t("type", { type }), cta: t("typeCta", { type }) };
  }
  if (kind === "mod") return { label: it.label, cta: t("modeCta", { mode: it.label }) };
  if (kind === "stat") {
    const label =
      value === "bst" ? t("stats.bst") : value === "height" ? t("stats.height") : value === "weight" ? t("stats.weight") : t("stats.stat", { stat: names.stats[STAT_KEY[value] ?? value] ?? value });
    return { label, cta: t("statCta") };
  }
  return { label: it.label, cta: it.cta };
}
