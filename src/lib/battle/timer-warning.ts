import { translator, type Translator } from "@/i18n/catalog";
import playNs from "@/messages/battle-play";

/** Showdown-style warnings as your turn's time runs low: at 30 and 10 seconds left. */
export const TIMER_WARNINGS = [30_000, 10_000] as const;

/** The warning to show with `left` ms to choose (null: none yet, or no clock running). */
export function timerWarning(left: number | null, t: Translator<typeof playNs.en> = translator(playNs, "en", undefined)): string | null {
  if (left === null || left <= 0) return null;
  if (left <= TIMER_WARNINGS[1]) return t("warn.left", { n: Math.ceil(left / 1000) });
  if (left <= TIMER_WARNINGS[0]) return t("warn.leftToChoose", { n: Math.ceil(left / 1000) });
  return null;
}
