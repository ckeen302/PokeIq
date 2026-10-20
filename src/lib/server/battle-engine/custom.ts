import "server-only";
import { Dex, Teams, TeamValidator } from "pokemon-showdown";
import { customFormatId, normalizeRules, type CustomRules } from "@/lib/battle/custom-rules";
import { completeSet, type TeamSet } from "@/lib/battle/sets";
import { legalRandomTeam } from "@/lib/server/battle";
import { prepareTeamFor, type TeamCheck } from "./teams";

/**
 * Custom rules on the server: every ruleset goes through Showdown's own
 * format parser (`Dex.formats.validate`) before anything uses it, since the
 * validator and the simulator would otherwise quietly fall back to the plain
 * Custom Game. Teams are then checked by Showdown's TeamValidator for exactly
 * that format.
 */

export type RulesCheck = { ok: true; rules: CustomRules; formatid: string } | { ok: false; errors: string[] };

/** Showdown's verdict on a ruleset: the validated format id, or its error messages. */
export function checkRules(raw: unknown): RulesCheck {
  const rules = normalizeRules(raw);
  try {
    const formatid = Dex.formats.validate(customFormatId(rules));
    // The rule table is what the battle and validator read: building it surfaces any remaining conflict.
    Dex.formats.getRuleTable(Dex.formats.get(formatid, true));
    return { ok: true, rules, formatid };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

/** A player's team for a ruleset: Showdown export (or packed) text, validated for it. */
export function prepareCustomTeam(rules: CustomRules, text: string): TeamCheck {
  const checked = checkRules(rules);
  if (!checked.ok) return checked;
  return prepareTeamFor(checked.formatid, text);
}

/**
 * Random-battle sets from the ruleset's generation that pass its validator,
 * `teamSize` of them: the "Quick team" and the computer's team.
 */
export function customRandomTeam(raw: CustomRules): TeamSet[] {
  const checked = checkRules(raw);
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  const { rules, formatid } = checked;
  const team = legalRandomTeam({
    generator: `gen${rules.gen}randombattle`,
    gen: rules.gen,
    level: rules.level,
    validator: TeamValidator.get(formatid),
    size: rules.teamSize,
  });
  if (!team.length) throw new Error("Couldn't find Pokémon that fit these rules.");
  return team.map((set) => completeSet({ ...set, name: "" }));
}

export const customCpuTeam = (rules: CustomRules): string => Teams.pack(customRandomTeam(rules));
