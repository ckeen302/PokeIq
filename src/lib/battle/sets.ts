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

/** A fresh slot for `species` at the format's level. */
export function newSet(species: string, format: BattleFormat): TeamSet {
  return completeSet({ species, level: format.level });
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

/** Showdown's export text: each set's lines end in two spaces, with a blank line after each set. */
export function exportShowdown(sets: readonly TeamSet[]): string {
  return sets.map((s) => Sets.exportSet(s)).join("");
}

/** Showdown's packed one-line team, what @pkmn/sim's battle streams take. */
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
