import { translator, type Translator } from "@/i18n/catalog";
import pikadoku from "@/messages/pikadoku";

/** How to play's rules for regions and forms, in order (keys of the pikadoku namespace's `rules`). */
export const PDK_RULE_KEYS = ["forms", "own", "region", "reuse", "species", "moves", "evolution"] as const;

/** The rules for regions and forms, in the page's language (English by default). */
export function pdkRules(t: Translator<typeof pikadoku.en> = translator(pikadoku, "en", undefined)): string[] {
  return PDK_RULE_KEYS.map((k) => t(`rules.${k}`));
}

/** The rules in English. */
export const PDK_RULES: readonly string[] = pdkRules();
