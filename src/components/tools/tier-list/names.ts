import type { Translator } from "@/i18n/catalog";
import type tierList from "@/messages/tier-list";
import type { Template } from "@/lib/tier-list/templates";
import type { Mode } from "@/lib/tier-list/state";

export type TierListT = Translator<typeof tierList.en>;

/** A template's short name, for cards and the bar: "Starters", "Gen 1", "Fire type". */
export function templateName(t: TierListT, tpl: Template): string {
  return t(`templates.${tpl.label}`, { n: tpl.gen ?? 0, type: tpl.type ? t(`typeNames.${tpl.type}`) : "" });
}

/** The name people search for: "Pokémon Starters", "Gen 1 Pokémon", "Fire-Type Pokémon". */
export function templateSeoName(t: TierListT, tpl: Template): string {
  return t(`seoNames.${tpl.label}`, { n: tpl.gen ?? 0, type: tpl.type ? t(`typeNames.${tpl.type}`) : "" });
}

export function modeName(t: TierListT, mode: Mode, topLength: number): string {
  return mode === "top" ? t("modes.top", { n: topLength }) : t(`modes.${mode}`);
}

/** The mode in a sentence ("a tier list"). */
export function modeNoun(t: TierListT, mode: Mode, topLength: number): string {
  return mode === "top" ? t("modes.topA", { n: topLength }) : t(`modes.${mode}A`);
}
