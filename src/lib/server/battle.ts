import "server-only";
import { Dex, Teams, TeamValidator } from "pokemon-showdown";
import { BATTLE_FORMATS, type BattleFormatId } from "@/lib/battle/formats";
import { completeSet, TEAM_SIZE, type TeamCheck, type TeamSet } from "@/lib/battle/sets";

/**
 * Team legality and random teams, on Pokémon Showdown's own rules
 * (the official simulator's TeamValidator). Server-side so the simulator's data never
 * ships to the browser; the battle engine will run here too.
 */

const validators = new Map<BattleFormatId, TeamValidator>();

function validator(format: BattleFormatId): TeamValidator {
  let v = validators.get(format);
  if (!v) {
    v = TeamValidator.get(format);
    validators.set(format, v);
  }
  return v;
}

/** The validator edits sets as it reads them, so it only ever sees copies. */
const copy = <T>(value: T): T => structuredClone(value);

export function checkTeam(format: BattleFormatId, sets: TeamSet[]): TeamCheck {
  const v = validator(format);
  const perSet = sets.map((set) => v.validateSet(copy(set), {}) ?? []);
  const seen = new Set(perSet.flat());
  const team = (v.validateTeam(copy(sets)) ?? []).filter((p) => !seen.has(p));
  return { ok: team.length === 0 && perSet.every((p) => p.length === 0), team, sets: perSet };
}

/**
 * Six random-battle sets that are legal in the format: sets are drawn from
 * the format's random-battle generator and kept when they pass the
 * validator, then the whole team is checked (Species and Item Clauses).
 */
export function randomTeam(format: BattleFormatId): TeamSet[] {
  const info = BATTLE_FORMATS[format];
  if (info.monotype) return monotypeTeam(format);
  return legalRandomTeam({ generator: info.random, gen: info.gen, level: info.level, validator: validator(format) });
}

/** Monotype (Same Type Clause): one type at a time, in random order, until a full legal team comes out. */
function monotypeTeam(format: BattleFormatId): TeamSet[] {
  const info = BATTLE_FORMATS[format];
  const dex = Dex.forGen(info.gen);
  const types = dex.types
    .all()
    .filter((t) => t.isNonstandard !== "Future" && t.name !== "???" && t.name !== "Stellar")
    .map((t) => t.name)
    .sort(() => Math.random() - 0.5);
  let best: TeamSet[] = [];
  for (const type of types) {
    const team = legalRandomTeam({ generator: info.random, gen: info.gen, level: info.level, validator: validator(format), tries: 2, draws: 40, keep: (s) => dex.species.get(s).types.includes(type) });
    if (team.length === TEAM_SIZE && !validator(format).validateTeam(copy(team))) return team;
    if (team.length > best.length) best = team;
  }
  return best;
}

/**
 * Random-battle sets from `generator` that pass `validator`, at `level`,
 * `size` of them: the team builder's random teams, and quick or computer
 * teams for any ruleset (custom rules, the Battle Tower). May come back
 * short if the generator rarely makes legal sets.
 */
export function legalRandomTeam(opts: { generator: string; gen: number; level: number; validator: TeamValidator; size?: number; tries?: number; draws?: number; keep?: (species: string) => boolean }): TeamSet[] {
  const size = opts.size ?? TEAM_SIZE;
  const generator = Teams.getGenerator(opts.generator);
  const dex = Dex.forGen(opts.gen);
  const v = opts.validator;
  let best: TeamSet[] = [];
  for (let attempt = 0; attempt < (opts.tries ?? 8); attempt++) {
    const team: TeamSet[] = [];
    const species = new Set<number>();
    const items = new Set<string>();
    for (let draw = 0; draw < (opts.draws ?? 12) && team.length < size; draw++) {
      for (const raw of generator.getTeam()) {
        if (team.length >= size) break;
        const set = completeSet({
          name: "",
          species: raw.species,
          item: raw.item ?? "",
          ability: raw.ability ?? "",
          moves: raw.moves.map((m: string) => dex.moves.get(m).name),
          nature: raw.nature ?? "",
          gender: raw.gender ?? "",
          evs: raw.evs,
          ivs: raw.ivs,
          level: opts.level,
          shiny: raw.shiny,
          teraType: opts.gen >= 9 ? raw.teraType : undefined,
        });
        if (opts.keep && !opts.keep(set.species)) continue;
        const num = dex.species.get(set.species).num;
        if (species.has(num) || (set.item && items.has(set.item))) continue;
        if (v.validateSet(copy(set), {})) continue;
        team.push(set);
        species.add(num);
        if (set.item) items.add(set.item);
      }
    }
    if (team.length > best.length) best = team;
    if (team.length === size && !v.validateTeam(copy(team))) return team;
  }
  return best;
}
