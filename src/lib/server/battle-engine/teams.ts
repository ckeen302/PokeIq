import "server-only";
import { PRNG, Teams, TeamValidator } from "pokemon-showdown";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng";
import { PLAY_FORMAT_INFO, BATTLE_TEAM_MAX, type PlayFormatId } from "@/lib/battle/play";
import { randomTeam as legalRandomTeam } from "@/lib/server/battle";
import type { BattleFormatId } from "@/lib/battle/formats";
import { completeSet, type TeamSet } from "@/lib/battle/sets";
import { newSeed, randomTeam } from "./engine";

/**
 * Teams for a battle: generated for random formats, brought by the player
 * otherwise. `prepareTeam` is the one way a player's team gets in, a saved
 * team-builder team or a pasted Showdown export alike: it
 * takes any Showdown team text (export, packed or JSON), validates it for
 * the format with the simulator's own TeamValidator and returns it packed.
 */

export type TeamCheck = { ok: true; packed: string; size: number } | { ok: false; errors: string[] };

const MAX_ERRORS = 8;

export function prepareTeam(format: PlayFormatId, text: string): TeamCheck {
  if (PLAY_FORMAT_INFO[format].random) return { ok: false, errors: ["This format uses random teams."] };
  return prepareTeamFor(format, text);
}

/** `prepareTeam` for any Showdown format id (custom rules included: validate the id first, see custom.ts). */
export function prepareTeamFor(formatid: string, text: string): TeamCheck {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, errors: ["Paste a team in Showdown's export format."] };
  if (trimmed.length > BATTLE_TEAM_MAX) return { ok: false, errors: ["That team is too long."] };
  let team: PokemonSet[] | null = null;
  try {
    team = Teams.import(trimmed);
  } catch {
    team = null;
  }
  if (!team || team.length === 0) return { ok: false, errors: ["That doesn't look like a Showdown team. Use Export in the team builder and paste all of it."] };
  // Nicknames are shown to the opponent: play under species names only.
  for (const set of team) set.name = "";
  let problems: string[] | null;
  try {
    problems = TeamValidator.get(formatid).validateTeam(team);
  } catch (err) {
    console.error("[battle] team validation failed:", err);
    return { ok: false, errors: ["Couldn't check that team. Try again."] };
  }
  if (problems?.length) {
    const errors = problems.slice(0, MAX_ERRORS);
    if (problems.length > MAX_ERRORS) errors.push(`…and ${problems.length - MAX_ERRORS} more.`);
    return { ok: false, errors };
  }
  return { ok: true, packed: Teams.pack(team), size: team.length };
}

type PokemonSet = ReturnType<typeof Teams.generate>[number];

/** The random-team generator's Battle Factory hooks (Showdown ships the sets with it). */
interface FactoryGenerator {
  factoryTier: string;
  randomFactoryTeam(side: { name: string }): PokemonSet[];
}

/** Battle Factory tiers Showdown ships sets for, by team format. */
const FACTORY_TIER: Partial<Record<PlayFormatId, string>> = { gen9ou: "OU", gen9ubers: "Uber", gen9uu: "UU" };

/**
 * Showdown's tournament-grade Battle Factory sets for the format's tier.
 * Tiers move, so a team is kept only once it passes the format's validator
 * (a few tries, then the team builder's random legal team).
 */
function factoryTeam(format: PlayFormatId, seed: string): PokemonSet[] {
  const tier = FACTORY_TIER[format];
  if (tier) {
    const prng = new PRNG(seed as PRNGSeed);
    const validator = TeamValidator.get(format);
    for (let attempt = 0; attempt < 5; attempt++) {
      const generator = Teams.getGenerator("gen9randombattle", prng.getSeed()) as FactoryGenerator;
      prng.random();
      generator.factoryTier = tier;
      const team = generator.randomFactoryTeam({ name: "p2" });
      if (!validator.validateTeam(structuredClone(team))) return team;
    }
  }
  return legalRandomTeam(format as BattleFormatId) as PokemonSet[];
}

/**
 * The player's "Quick team": Battle Factory sets where Showdown has them
 * (OU, Ubers, UU), otherwise six random-battle sets that pass the format's
 * validator. Sets come back nameless and complete, as the team builder keeps them.
 */
export function quickTeam(format: PlayFormatId, seed: string = newSeed()): TeamSet[] {
  if (PLAY_FORMAT_INFO[format].random) throw new Error("This format uses random teams.");
  return factoryTeam(format, seed).map((set) => completeSet({ ...set, name: "" }));
}

/**
 * The computer's team for `format`: a random team in random formats,
 * Battle Factory sets in OU, and in the other team formats six random-battle
 * sets that pass the format's validator (the team builder's random teams).
 */
export function cpuTeam(format: PlayFormatId, seed: string = newSeed()): string {
  if (PLAY_FORMAT_INFO[format].random) return randomTeam(format, seed);
  if (format === "gen9ou") return Teams.pack(factoryTeam(format, seed));
  return Teams.pack(legalRandomTeam(format as BattleFormatId) as PokemonSet[]);
}

/** A seat's team at the start: generated in random formats, otherwise the one they brought. */
export function seatTeam(format: PlayFormatId, brought: string | undefined): string {
  if (PLAY_FORMAT_INFO[format].random) return randomTeam(format, PRNG.generateSeed());
  if (!brought) throw new Error(`A ${format} battle can't start without a team.`);
  return brought;
}
