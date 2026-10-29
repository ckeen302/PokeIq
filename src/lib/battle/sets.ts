import { Sets, Team, Teams, type Data, type PokemonSet } from "@pkmn/sets";
import { z } from "zod";
import type { StatKey } from "@/lib/pokemon/constants";
import type { BattleFormat } from "./formats";

/**
 * Team members in Pokémon Showdown's own shape (@pkmn/sets' PokemonSet), so a
 * team round-trips through Showdown's text format and packs straight into
 * the battle engine. Pure helpers, shared by the browser and the server.
 */

export type TeamSet = PokemonSet;
export type StatsTable = Record<StatKey, number>;
/** A set with any field left out but its species. */
export type PartialSet = Omit<Partial<TeamSet>, "evs" | "ivs"> & {
  species: string;
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
};

export const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
export const TEAM_SIZE = 6;
export const MAX_TOTAL_EVS = 510;
/**
 * The editor's cap: every 4 EVs is one stat point at level 100, so the last
 * 2 of the 510 the validator allows can never do anything (Showdown's own
 * teambuilder counts down from 508 as well).
 */
export const USEFUL_TOTAL_EVS = 508;
export const MAX_EVS = 252;
export const MAX_IV = 31;

const fill = (value: number): StatsTable => ({ hp: value, atk: value, def: value, spa: value, spd: value, spe: value });

const stat = z.number().int().min(0).max(255);
const statsSchema = z.object({ hp: stat, atk: stat, def: stat, spa: stat, spd: stat, spe: stat }).partial();
const text = (max: number) => z.string().max(max);

/** A set as stored or sent to the server. Unknown fields are dropped. */
export const setSchema = z.object({
  name: text(40).optional(),
  species: text(60).min(1),
  item: text(60).optional(),
  ability: text(60).optional(),
  moves: z.array(text(60)).max(8),
  nature: text(20).optional(),
  gender: text(2).optional(),
  evs: statsSchema.optional(),
  ivs: statsSchema.optional(),
  level: z.number().int().min(1).max(100).optional(),
  shiny: z.boolean().optional(),
  happiness: stat.optional(),
  pokeball: text(40).optional(),
  hpType: text(20).optional(),
  dynamaxLevel: z.number().int().min(0).max(10).optional(),
  gigantamax: z.boolean().optional(),
  teraType: text(20).optional(),
});

/**
 * Fills a parsed set out to a full one. A missing level means 100 and
 * missing IVs mean 31, as in Showdown, so exporting it again gives back the
 * same text.
 */
export function completeSet(set: PartialSet): TeamSet {
  const out: TeamSet = {
    name: set.name ?? "",
    species: set.species,
    item: set.item ?? "",
    ability: set.ability ?? "",
    moves: (set.moves ?? []).filter(Boolean).slice(0, 4),
    nature: set.nature ?? "",
    gender: set.gender ?? "",
    evs: { ...fill(0), ...set.evs },
    ivs: { ...fill(MAX_IV), ...set.ivs },
    level: set.level ?? 100,
  };
  if (set.shiny) out.shiny = true;
  if (set.happiness !== undefined) out.happiness = set.happiness;
  if (set.pokeball) out.pokeball = set.pokeball;
  if (set.hpType) out.hpType = set.hpType;
  if (set.dynamaxLevel !== undefined) out.dynamaxLevel = set.dynamaxLevel;
  if (set.gigantamax) out.gigantamax = true;
  if (set.teraType) out.teraType = set.teraType;
  return out;
}

/** Parses and fills an untrusted set; null if it isn't one. */
export function normalizeSet(raw: unknown): TeamSet | null {
  const parsed = setSchema.safeParse(raw);
  return parsed.success ? completeSet(parsed.data) : null;
}

// ---------------------------------------------------------------------------
// Stats by generation, as Showdown's validator rules them
// ---------------------------------------------------------------------------

/**
 * Gen 1-2 have DVs (0-15) where later games have IVs, stored as IVs the way
 * Showdown does (the simulator reads DV = IV / 2, rounded down), and stat
 * experience where later games have EVs: up to 252 in every stat, with no
 * total (Showdown's "EV Limit = Auto" is 510 from Gen 3 only).
 */
export const hasDVs = (gen: number) => gen <= 2;
export const evLimit = (gen: number): number | null => (hasDVs(gen) ? null : MAX_TOTAL_EVS);
export const MAX_DV = 15;
export const toDV = (iv: number) => Math.floor(iv / 2);
export const fromDV = (dv: number) => dv * 2 + 1;

/**
 * Gen 1-2 sets brought in line with how those games work, as Showdown's
 * validator requires: one Special DV and stat experience for both SpA and
 * SpD, and the HP DV made of the low bits of the Atk, Def, Spe and Special
 * DVs. Later generations are left alone.
 */
export function fitStatsToGen<T extends { evs: StatsTable; ivs: StatsTable }>(stats: T, gen: number): T {
  if (!hasDVs(gen)) return stats;
  const dv = (s: StatKey) => toDV(stats.ivs[s]);
  const hp = (dv("atk") % 2) * 8 + (dv("def") % 2) * 4 + (dv("spe") % 2) * 2 + (dv("spa") % 2);
  return {
    ...stats,
    evs: { ...stats.evs, spd: stats.evs.spa },
    ivs: { ...stats.ivs, hp: fromDV(hp), spd: stats.ivs.spa },
  };
}

/**
 * A set as its generation can have it: no ability or nature before Gen 3,
 * no held item in Gen 1 (a Custom Game would still apply them), and Gen 1-2
 * stats as `fitStatsToGen` has them.
 */
export function fitSetToGen(set: TeamSet, gen: number): TeamSet {
  const out = fitStatsToGen(set, gen);
  if (gen >= 3) return out;
  return { ...out, ability: "", nature: "", item: gen === 1 ? "" : out.item };
}

/**
 * A fresh slot for `species` at the format's level. Showdown's own team
 * builder defaults: no nature (Serious, neutral), 31 IVs, no EVs, except
 * in Gen 1-2, where stat experience is free and maxed out.
 */
export function newSet(species: string, format: Pick<BattleFormat, "level"> & { gen?: number }): TeamSet {
  const set = completeSet({ species, level: format.level });
  if (format.gen !== undefined && hasDVs(format.gen)) set.evs = fill(MAX_EVS);
  return set;
}

/**
 * The nature you get by clicking a stat's name in the stat editor, as in
 * Showdown: a stat goes neutral -> + -> − -> neutral. A + with no − yet takes
 * the usual partner (−SpA, or −Atk for a SpA boost); a + turned − moves the
 * + to Atk (or SpA when Atk is the one lowered).
 */
export function natureFor<N extends { name: string; plus?: string; minus?: string }>(natures: readonly N[], current: N | undefined, stat: StatKey): N | undefined {
  const partner = (s: string) => (s === "atk" ? "spa" : "atk");
  const neutral = () => natures.find((n) => n.name === "Serious");
  let plus = current?.plus && current.plus !== current.minus ? current.plus : null;
  let minus = plus ? (current?.minus ?? null) : null;
  if (minus === stat) return neutral();
  if (plus === stat) {
    minus = stat;
    plus = partner(stat);
  } else {
    plus = stat;
    if (!minus || minus === stat) minus = stat === "spa" ? "atk" : "spa";
  }
  if (plus === minus) return neutral();
  return natures.find((n) => n.plus === plus && n.minus === minus);
}

export function evTotal(set: TeamSet): number {
  return STATS.reduce((sum, s) => sum + (set.evs[s] ?? 0), 0);
}

/** Pokémon Showdown's verdict on a team (POST /api/battle/validate). */
export interface TeamCheck {
  ok: boolean;
  /** Problems with the team as a whole (size, Species Clause, Item Clause…). */
  team: string[];
  /** Problems with each set, in slot order. */
  sets: string[][];
}

// ---------------------------------------------------------------------------
// Showdown text and packed teams
// ---------------------------------------------------------------------------

export interface ImportedTeam {
  sets: TeamSet[];
  /** From a "=== [gen9ou] Name ===" header, when there is one. */
  name?: string;
  format?: string;
  /** Sets past the sixth, left out. */
  dropped: number;
}

/** Reads a Showdown export (one team, header optional); null if there's no Pokémon in it. */
export function importShowdown(input: string): ImportedTeam | null {
  const team = Teams.importTeam(input.replace(/\r\n?/g, "\n"));
  const sets = (team?.team ?? []).filter((s) => s.species).map((s) => completeSet({ ...s, species: s.species! }));
  if (!sets.length) return null;
  return {
    sets: sets.slice(0, TEAM_SIZE),
    name: team?.name || undefined,
    format: team?.format || undefined,
    dropped: Math.max(0, sets.length - TEAM_SIZE),
  };
}

/**
 * Every team in a Showdown teambuilder backup ("Backup all teams": one
 * "=== [format] Name ===" header per team). Text without headers is one team.
 */
export function importShowdownTeams(input: string): ImportedTeam[] {
  const text = input.replace(/\r\n?/g, "\n");
  if ((text.match(/^===.*===\s*$/gm) ?? []).length < 2) {
    const one = importShowdown(text);
    return one ? [one] : [];
  }
  return Teams.importTeams(text)
    .map((team) => {
      const sets = team.team.filter((s) => s.species).map((s) => completeSet({ ...s, species: s.species! }));
      return { sets: sets.slice(0, TEAM_SIZE), name: team.name || undefined, format: team.format || undefined, dropped: Math.max(0, sets.length - TEAM_SIZE) };
    })
    .filter((t) => t.sets.length > 0);
}

/** Showdown's export text: each set's lines end in two spaces, with a blank line after each set. */
export function exportShowdown(sets: readonly TeamSet[]): string {
  return sets.map((s) => Sets.exportSet(s)).join("");
}

/** Showdown's packed one-line team, what the simulator takes. */
export function packTeam(sets: readonly TeamSet[]): string {
  return new Team([...sets]).pack();
}

/** Packed teams hold ids ("Uturn"): pass a Dex (@pkmn/dex, @pkmn/sim) to get names back. */
export function unpackTeam(packed: string, data?: Data): TeamSet[] | null {
  const team = Teams.unpackTeam(packed, data);
  if (!team) return null;
  // Unpacking spells out the defaults text leaves implicit: no nickname, full happiness, Dynamax Level 10.
  return team.team.filter((s) => s.species).map((s) =>
    completeSet({
      ...s,
      name: s.name === s.species ? "" : s.name,
      happiness: s.happiness === 255 ? undefined : s.happiness,
      dynamaxLevel: s.dynamaxLevel === 10 ? undefined : s.dynamaxLevel,
    })
  );
}
