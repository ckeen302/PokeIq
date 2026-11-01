import NAMES from "@/data/trainer-team-names.json";
import type { TeamEntry, TeamMon } from "./types";

/**
 * Whose Team Is This?: the parts both the server and the browser need. Client
 * safe (the rounds themselves, src/data/trainer-teams.json, stay on the
 * server: see engines/modules/whose-team.ts).
 */

export type { TeamEntry, TeamMon };

/** From this daily on, the Daily Challenge's last question is a Whose Team round (server: whose-team-daily.ts). */
export const TEAM_DAILY_FROM = "2026-11-08";

export interface TrainerName {
  name: string;
  /** Other names for the same person ("Green" for Blue). They autocomplete to `name`. */
  aliases?: string[];
  note?: string;
}

/** Every trainer with a round, A to Z: the answers the guess box autocompletes over. */
export const TRAINER_NAMES: TrainerName[] = NAMES as TrainerName[];
export const ANSWER_NAMES: string[] = TRAINER_NAMES.map((n) => n.name);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Autocomplete: names (or aliases) that start with what was typed come first,
 * then names containing it anywhere. Returns answer names, each once.
 */
export function suggest(query: string, names: readonly TrainerName[] = TRAINER_NAMES, limit = 6): { name: string; via?: string }[] {
  const q = fold(query);
  if (!q) return [];
  const starts: { name: string; via?: string }[] = [];
  const contains: { name: string; via?: string }[] = [];
  for (const n of names) {
    const keys: { key: string; via?: string }[] = [{ key: n.name }, ...(n.aliases ?? []).map((a) => ({ key: a, via: a }))];
    let best: { rank: number; via?: string } | null = null;
    for (const k of keys) {
      const f = fold(k.key);
      // Word starts count as starts too ("wake" finds Crasher Wake).
      const words = k.key.split(/[\s.&-]+/).map(fold);
      const rank = f.startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : f.includes(q) ? 2 : -1;
      if (rank >= 0 && (!best || rank < best.rank)) best = { rank, via: k.via };
    }
    if (!best) continue;
    (best.rank < 2 ? starts : contains).push({ name: n.name, ...(best.via && { via: best.via }) });
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The answer a typed guess means, when it names exactly one trainer (an exact name or alias). */
export function resolveGuess(text: string, names: readonly TrainerName[] = TRAINER_NAMES): string | null {
  const q = fold(text);
  if (!q) return null;
  const hit = names.find((n) => fold(n.name) === q || (n.aliases ?? []).some((a) => fold(a) === q));
  return hit?.name ?? null;
}

/**
 * Hard mode: the share of a right answer's points kept after seeing `shown`
 * of `total` Pokémon. One Pokémon keeps everything; the whole team keeps 40%.
 */
export function revealFactor(shown: number, total: number): number {
  if (total <= 1) return 1;
  const s = Math.min(Math.max(shown, 1), total);
  return 1 - (0.6 * (s - 1)) / (total - 1);
}

const monKey = (m: TeamMon) => `${m.dex}:${m.form ?? ""}`;

/**
 * The order Hard mode reveals a team in: party order, but the ace (and, for a
 * trainer whose partner is in every team, that partner) held back to the end,
 * so the first Pokémon shown isn't a giveaway.
 */
export function revealOrder(entry: Pick<TeamEntry, "team" | "ace">): TeamMon[] {
  const aceIndex = entry.team.findLastIndex((m) => (m.form ? `${m.species} (${m.form})` : m.species) === entry.ace);
  if (aceIndex < 0) return [...entry.team];
  const rest = entry.team.filter((_, i) => i !== aceIndex);
  return [...rest, entry.team[aceIndex]];
}

/** A set of species, ignoring order: two rounds with the same key can't be told apart. */
export const teamKey = (team: readonly TeamMon[]) => team.map(monKey).sort().join(",");

export const monLabel = (m: TeamMon) => (m.form ? `${m.species} (${m.form})` : m.species);
