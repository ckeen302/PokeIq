import { type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import type board from "@/messages/pokedle-board";
import { DLE_ASSIST_INFO, type DleAssist } from "./dle-assist";
import { rangeOfGens, rulesBonus, type DleRules } from "./dle-format";
import type { DleColumn } from "./dle-types";

/**
 * Pokédle's words in the page's language: the rules' tags, the Pokédex levels and the board's values. The English
 * versions in dle-format / dle-assist stay for the server and the share card; these give the same English
 * (tests/pokedle-i18n.test.ts) and every other language from the pokedle-board namespace.
 */

export type BoardT = Translator<typeof board.en>;

/**
 * What the board's values need in a language besides its messages, sent by the page (English pages send nothing):
 * type, colour and region names keyed by the English name in lowercase ("fire", "red", "kanto").
 */
export interface DleLabels {
  types: Record<string, string>;
  colors: Record<string, string>;
  regions: Record<string, string>;
}

/** "Gen 1", "Gen 1–4", "All gens". */
export function localGensText(gens: readonly number[], t: BoardT): string {
  if (!gens.length) return t("gens.all");
  const [lo, hi] = rangeOfGens(gens);
  if (gens.length !== hi - lo + 1) return t("gens.list", { list: gens.join(", ") });
  return lo === hi ? t("gens.one", { n: lo }) : t("gens.range", { lo, hi });
}

/** As dle-format's rulesTags, in the page's language; `guesses: false` leaves the guess count out (the share). */
export function localRulesTags(rules: DleRules, t: BoardT, extra: { dex?: string; hard?: boolean; guesses?: boolean } = {}): string[] {
  const tags: string[] = [t(`format.${rules.format}`)];
  if (rules.format === "custom") tags.push(t("tags.clues", { n: rules.columns.length }));
  if (rules.gens.length) tags.push(localGensText(rules.gens, t));
  if (extra.guesses !== false) tags.push(t("tags.guesses", { n: rules.maxGuesses }));
  if (rules.format !== "squirdle" && !rules.close) tags.push(t("tags.strict"));
  if (!rules.hints) tags.push(t("tags.noHints"));
  if (rules.timer !== "none") tags.push(t(`timer.${rules.timer}`));
  if (rules.pool === "legendary") tags.push(t("tags.legendaries"));
  if (extra.dex) tags.push(extra.dex);
  if (extra.hard) tags.push(t("tags.hard"));
  return tags;
}

/** "+20%", or "" for none. */
export function localBonusText(rules: Pick<DleRules, "columns" | "close">, t: BoardT): string {
  const b = rulesBonus(rules);
  return b > 0 ? t("bonus", { pct: Math.round(b * 100) }) : "";
}

/** "×1.25", "×0,7". */
export const localMultiplier = (assist: DleAssist, t: BoardT) => `×${formatNumber(DLE_ASSIST_INFO[assist].multiplier, t.locale)}`;

/** The Pokédex level's name, or "No dex" for Off (the tags and the result). */
export const dexTag = (assist: DleAssist, t: BoardT) => (assist === "off" ? t("tags.noDex") : t(`assist.${assist}.label`));

/** "Baby", or the stage number. */
export const localStage = (stage: number, t: BoardT) => (stage === 0 ? t("value.baby") : String(stage));

/** A name as the data keys it: the English name lowercased, letters and digits only ("Mouse Pokémon" → "mousepokemon"). */
export const dataKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** A type, colour or region in the language (the English name, as given, when there are no labels or none for it). */
export const labelOf = (kind: keyof DleLabels, english: string, labels: DleLabels | undefined) => labels?.[kind][english.toLowerCase()] ?? english;

/**
 * A board value as the API sends it (in English: "Fire", "None", "1.2 m", "Red", "Baby") in the page's language.
 * English (no labels): exactly as sent.
 */
export function localCellValue(column: DleColumn, value: string, t: BoardT, labels: DleLabels | undefined): string {
  if (!labels) return value;
  switch (column) {
    case "type1":
    case "type2":
      return value === "None" ? t("value.none") : labelOf("types", value, labels);
    case "color":
      return labelOf("colors", value, labels);
    case "stage":
      return value === "Baby" ? t("value.baby") : value;
    case "height":
    case "weight": {
      const m = /^(\d+(?:\.\d+)?) (m|kg)$/.exec(value);
      return m ? `${formatNumber(Number(m[1]), t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${m[2]}` : value;
    }
    default:
      return value;
  }
}

/** Height in decimetres and weight in hectograms as the board shows them, in the language: "1.2 m", "6,0 kg". */
export const localMeasure = (tenths: number, unit: "m" | "kg", t: BoardT) =>
  `${t.locale === "en" ? (tenths / 10).toFixed(1) : formatNumber(tenths / 10, t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
