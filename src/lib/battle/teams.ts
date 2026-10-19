"use client";

import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { BATTLE_FORMAT_IDS, type BattleFormatId } from "./formats";
import { exportShowdown, normalizeSet, packTeam, TEAM_SIZE, type TeamSet } from "./sets";

/**
 * Saved battle teams, local-first in localStorage like trainer progress.
 *
 * For battles, this is the whole API:
 *   listTeams(format?)      saved teams, newest first, optionally one format's
 *   teamShowdownText(id)    a team as Showdown export text, what a battle takes
 *   useTeams(format?)       the same list as a React hook
 * A team's sets are Showdown sets for its format (@pkmn/sets' PokemonSet);
 * packedTeam(id) gives the one-line packed form @pkmn/sim also reads.
 * replaceTeams() and onTeamsChange() are the hooks for syncing teams to a
 * trainer account the way progress is synced.
 */

export interface BattleTeam {
  id: string;
  name: string;
  format: BattleFormatId;
  /** Up to six, in slot order. */
  sets: TeamSet[];
  createdAt: number;
  updatedAt: number;
}

interface Store {
  v: 1;
  teams: BattleTeam[];
}

const KEY = "pokeiq:battle-teams:v1";
export const MAX_TEAMS = 200;
const EMPTY: Store = { v: 1, teams: [] };

const teamSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(60),
  format: z.enum(BATTLE_FORMAT_IDS),
  sets: z.array(z.unknown()).max(TEAM_SIZE),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Keeps every well-formed team (and set) from untrusted data, newest first. */
export function normalizeTeams(raw: unknown): BattleTeam[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as Store).teams) ? (raw as Store).teams : [];
  const out: BattleTeam[] = [];
  for (const item of list) {
    const parsed = teamSchema.safeParse(item);
    if (!parsed.success) continue;
    const sets = parsed.data.sets.map(normalizeSet).filter((s): s is TeamSet => s !== null);
    out.push({ ...parsed.data, sets });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_TEAMS);
}

// ---------------------------------------------------------------------------
// Store (useSyncExternalStore over localStorage)
// ---------------------------------------------------------------------------

let cache: Store | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { v: 1, teams: normalizeTeams(JSON.parse(raw)) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(teams: BattleTeam[]) {
  cache = { v: 1, teams: [...teams].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_TEAMS) };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode / quota: teams just won't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getTeamsSnapshot = () => read().teams;

/**
 * Saved teams, most recently edited first; with `format`, only that format's.
 * Null during SSR / before hydration.
 */
export function useTeams(format?: BattleFormatId): BattleTeam[] | null {
  const teams = useSyncExternalStore(subscribe, getTeamsSnapshot, () => null);
  return useMemo(() => (teams && format ? teams.filter((t) => t.format === format) : teams), [teams, format]);
}

/** Saved teams, most recently edited first; with `format`, only that format's. */
export function listTeams(format?: BattleFormatId): BattleTeam[] {
  const teams = read().teams;
  return format ? teams.filter((t) => t.format === format) : teams;
}

export function getTeams(): BattleTeam[] {
  return read().teams;
}

export function getTeam(id: string): BattleTeam | undefined {
  return read().teams.find((t) => t.id === id);
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTeam(format: BattleFormatId, name = "Untitled team", sets: TeamSet[] = []): BattleTeam {
  const now = Date.now();
  const team: BattleTeam = { id: newId(), name, format, sets: sets.slice(0, TEAM_SIZE), createdAt: now, updatedAt: now };
  write([team, ...read().teams]);
  return team;
}

/** Saves a new version of a team (matched by id), stamped as just edited. */
export function saveTeam(team: BattleTeam): BattleTeam {
  const saved = { ...team, sets: team.sets.slice(0, TEAM_SIZE), updatedAt: Math.max(Date.now(), team.updatedAt + 1) };
  write([saved, ...read().teams.filter((t) => t.id !== team.id)]);
  return saved;
}

export function deleteTeam(id: string) {
  write(read().teams.filter((t) => t.id !== id));
}

export function duplicateTeam(id: string): BattleTeam | null {
  const team = getTeam(id);
  if (!team) return null;
  return createTeam(team.format, `${team.name} (copy)`.slice(0, 60), structuredClone(team.sets));
}

/** Replaces every team — for syncing with a trainer account. */
export function replaceTeams(teams: unknown) {
  write(normalizeTeams({ teams }));
}

/** Notifies on every local change, for pushing teams to an account. */
export function onTeamsChange(listener: (teams: BattleTeam[]) => void): () => void {
  const wrapped = () => listener(read().teams);
  listeners.add(wrapped);
  return () => listeners.delete(wrapped);
}

/** A saved team as Showdown export text (what Showdown's Import / Export shows); null if there's no such team. */
export function teamShowdownText(id: string): string | null {
  const team = getTeam(id);
  return team ? exportShowdown(team.sets) : null;
}

/** A saved team in Showdown's packed one-line format. */
export function packedTeam(id: string): string | null {
  const team = getTeam(id);
  return team ? packTeam(team.sets) : null;
}
