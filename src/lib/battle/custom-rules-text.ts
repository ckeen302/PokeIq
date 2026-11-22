import type { Translator } from "@/i18n/catalog";
import type rulesNs from "@/messages/battle-rules";
import { CLAUSES, CLAUSE_INFO, GIMMICKS, GIMMICK_INFO, describeRules, gimmickAllowed, type Clause, type CustomRules, type Gimmick } from "./custom-rules";

/**
 * A custom ruleset's words in the page's language (src/messages/<locale>/battle-rules.json): its gimmicks, clauses
 * and the lines describeRules gives. English gets custom-rules.ts's own text back, untouched.
 */

export type RulesT = Translator<typeof rulesNs.en>;

export function gimmickName(t: RulesT, g: Gimmick): string {
  if (t.locale === "en") return GIMMICK_INFO[g].name;
  return t(`gimmick.${g}`);
}

export function clauseName(t: RulesT, c: Clause): string {
  if (t.locale === "en") return CLAUSE_INFO[c].name;
  return t(`clause.${c}.name`);
}

export function clauseBlurb(t: RulesT, c: Clause): string {
  if (t.locale === "en") return CLAUSE_INFO[c].blurb;
  return t(`clause.${c}.blurb`);
}

/** describeRules in the page's language: the ruleset as players read it, one line each. */
export function describeRulesIn(t: RulesT, rules: CustomRules): { label: string; text: string }[] {
  if (t.locale === "en") return describeRules(rules);
  if (rules.base) return [{ label: t("describe.format"), text: t("describe.formatText", { name: rules.baseName ?? rules.base, random: rules.baseRandom ? "yes" : "no" }) }];
  const gimmicks = GIMMICKS.filter((g) => gimmickAllowed(g, rules.gen));
  const clauses = CLAUSES.filter((c) => rules.clauses[c]).map((c) => clauseName(t, c));
  const list = (items: string[]) => items.join(t.locale === "ja" ? "、" : ", ");
  const out = [
    { label: t("describe.mechanics"), text: t("describe.generation", { gen: rules.gen }) },
    { label: t("describe.level"), text: t(rules.levelMode === "fixed" ? "describe.levelFixed" : "describe.levelCap", { level: rules.level }) },
    {
      label: t("describe.teams"),
      text: rules.pick !== null ? t("describe.bringPick", { size: rules.teamSize, pick: rules.pick }) : t("describe.each", { size: rules.teamSize }),
    },
    { label: t("describe.clauses"), text: clauses.length ? list(clauses) : t("describe.none") },
  ];
  if (gimmicks.length)
    out.push({
      label: t("describe.gimmicks"),
      text: list(gimmicks.map((g) => t(rules.gimmicks[g] ? "describe.gimmickOn" : "describe.gimmickOff", { name: gimmickName(t, g) }))),
    });
  return out;
}
