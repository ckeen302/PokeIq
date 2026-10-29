import "server-only";
import { Dex, Teams, TeamValidator } from "pokemon-showdown";
import { customFormatId, normalizeRules, type CustomRules } from "@/lib/battle/custom-rules";
import { catalogueFormat, isPlayableFormat } from "@/lib/battle/format-catalogue";
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
  if (rules.base) {
    const format = catalogueFormat(rules.base);
    if (!format || !isPlayableFormat(rules.base)) return { ok: false, errors: [`${rules.base} isn't a format that can be played here.`] };
    rules.baseName = format.name;
    rules.baseRandom = format.random;
    rules.gen = format.gen as CustomRules["gen"];
  }
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
  // A random Showdown format deals every team itself: whatever was sent, the seat gets a fresh one.
  if (Dex.formats.get(checked.formatid).team) {
    const team = Teams.generate(checked.formatid);
    return { ok: true, packed: Teams.pack(team), size: team.length };
  }
  return prepareTeamFor(checked.formatid, text);
}

/**
 * A team for one of Showdown's own formats (the format catalogue): the
 * format's own generator for random formats, otherwise random-battle sets
 * of its generation (doubles sets for doubles) that its TeamValidator passes.
 */
export function catalogueTeam(formatid: string): TeamSet[] {
  const format = Dex.formats.get(formatid, true);
  if (format.team) return Teams.generate(formatid) as TeamSet[];
  const table = Dex.formats.getRuleTable(format);
  const dex = Dex.forFormat(format);
  const gen = dex.gen;
  const size = Math.min(6, Math.max(table.minTeamSize, table.maxTeamSize, 1));
  const level = table.adjustLevel ?? Math.min(table.maxLevel, 100);
  const validator = TeamValidator.get(formatid);
  const doubles = `gen${gen}randomdoublesbattle`;
  // The format's own mod's random battle when it has one (e.g. Champions), else its generation's.
  const modRandom = `${format.mod}randombattle`;
  const generator =
    table.has("littlecup") && gen === 9
      ? "gen9babyrandombattle"
      : format.gameType === "doubles" && Dex.formats.get(doubles).exists
        ? doubles
        : Dex.formats.get(modRandom).exists && Dex.formats.get(modRandom).team
          ? modRandom
          : `gen${gen}randombattle`;
  const legal = (team: TeamSet[]) => team.length >= size && !validator.validateTeam(structuredClone(team));
  // Same Type Clause: one type at a time, in random order.
  const types = table.has("sametypeclause")
    ? dex.types
        .all()
        .filter((t) => t.isNonstandard !== "Future" && t.name !== "???" && t.name !== "Stellar")
        .map((t) => t.name)
        .sort(() => Math.random() - 0.5)
    : [null];
  let team: TeamSet[] = [];
  // Hard formats (Little Cup, Same Type Clause) can come up short: a few more rounds before giving up.
  for (let round = 0; round < 3 && !legal(team); round++)
    for (const type of types) {
      team = legalRandomTeam({
        generator,
        gen,
        level,
        validator,
        size,
        ...(type
          ? {
              tries: 2,
              draws: 40,
              keep: (s: string) => dex.species.get(s).types.includes(type),
            }
          : {}),
      });
      if (legal(team)) break;
    }
  if (!legal(team)) throw new Error("Couldn't find Pokémon that fit these rules.");
  return team.map((set) => completeSet({ ...set, name: "" }));
}

/**
 * Random-battle sets from the ruleset's generation that pass its validator,
 * `teamSize` of them: the "Quick team" and the computer's team.
 */
export function customRandomTeam(raw: CustomRules): TeamSet[] {
  const checked = checkRules(raw);
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  const { rules, formatid } = checked;
  if (rules.base) return catalogueTeam(formatid);
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
