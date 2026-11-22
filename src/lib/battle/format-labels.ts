import type { Translator } from "@/i18n/catalog";
import type formats from "@/messages/battle-formats";
import { customName, type CustomRules } from "./custom-rules";
import { CPU_LEVEL_INFO, PLAY_FORMAT_INFO, type CpuLevel, type GameType, type PlayFormatId } from "./play";

/**
 * The battle setup's words for formats in the page's language (src/messages/<locale>/battle-formats.json): a
 * format's short label and blurb, the computer's levels, game types and a custom ruleset's name. English gets
 * play.ts's own text back, untouched. Showdown's format names ("[Gen 9] OU") are proper names and stay as they are;
 * only our own labels ("Custom rules", "Battle Tower") are translated.
 */

export type FormatsT = Translator<typeof formats.en>;
type Key = Parameters<FormatsT>[0];

const PAST = /^gen([1-8])(randombattle|ou|uu)$/;

/** A format's full name: Showdown's, or ours for custom rules and the Tower. */
export function formatName(t: FormatsT, id: PlayFormatId): string {
  if (t.locale === "en") return PLAY_FORMAT_INFO[id].name;
  return id === "custom" || id === "tower" ? t(`name.${id}`) : PLAY_FORMAT_INFO[id].name;
}

/** "Random Battle", "OU", "Gen 4 Random". */
export function formatShort(t: FormatsT, id: PlayFormatId): string {
  if (t.locale === "en") return PLAY_FORMAT_INFO[id].short;
  const past = PAST.exec(id);
  if (past) return past[2] === "randombattle" ? t("pastRandom", { gen: past[1] }) : t("pastTier", { gen: past[1], tier: past[2].toUpperCase() });
  const key = `short.${id}`;
  return t.has(key) ? t(key as Key) : PLAY_FORMAT_INFO[id].short;
}

export function formatBlurb(t: FormatsT, id: PlayFormatId): string {
  if (t.locale === "en") return PLAY_FORMAT_INFO[id].blurb;
  const past = PAST.exec(id);
  if (past) return past[2] === "randombattle" ? t("pastRandomBlurb", { gen: past[1] }) : t("bring");
  const key = `blurb.${id}`;
  return t.has(key) ? t(key as Key) : t("bring");
}

export function cpuLevelName(t: FormatsT, level: CpuLevel): string {
  if (t.locale === "en") return CPU_LEVEL_INFO[level].name;
  return t(`cpu.${level}.name`);
}

export function cpuLevelBlurb(t: FormatsT, level: CpuLevel): string {
  if (t.locale === "en") return CPU_LEVEL_INFO[level].blurb;
  return t(`cpu.${level}.blurb`);
}

/** How the setup names a game type beyond singles. */
export function gameTypeLabel(t: FormatsT, type: GameType): string | undefined {
  if (type === "singles") return undefined;
  return t(`gameType.${type}`);
}

/** A ruleset's short name ("[Gen 4] Custom · Lv 50"); one of Showdown's formats keeps its own name. */
export function customRulesName(t: FormatsT, rules: CustomRules): string {
  if (t.locale === "en" || rules.base) return customName(rules);
  return t(rules.levelMode === "cap" ? "custom.nameCap" : "custom.name", { gen: rules.gen, level: rules.level });
}

/** A format's name as the setup shows it: a custom ruleset's own, or the format's. */
export function playFormatLabel(t: FormatsT, id: PlayFormatId, rules: CustomRules): string {
  return id === "custom" ? customRulesName(t, rules) : formatName(t, id);
}
