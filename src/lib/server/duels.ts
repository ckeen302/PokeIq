import "server-only";
import type { PvpView } from "@/lib/pvp-types";
import {
  joinPvp,
  leavePvp,
  linkRematchPvp,
  readyPvp,
  rematchPvp,
  takeRematchSeatPvp,
  touchPvp,
  type PvpFailure,
  type PvpOutcome,
  type PvpRules,
} from "./duel-core";
import { pokedleRules, pokedleView, type PokedleDuel } from "./pokedle-duel";

/**
 * Every duel in the shared `duels` table, whatever its game: the lobby,
 * presence and rematch steps from duel-core.ts with each game's own rules,
 * and each game's view. Game moves (a Pokédle guess) live with their game.
 */

export type PvpDuel = PokedleDuel;

const RULES: { [K in PvpDuel["kind"]]: PvpRules<Extract<PvpDuel, { kind: K }>> } = {
  pokedle: pokedleRules,
};

const rulesOf = (duel: PvpDuel) => RULES[duel.kind] as PvpRules<PvpDuel>;

export const touchDuel = (duel: PvpDuel, playerId: string | null, now: number) => touchPvp(rulesOf(duel), duel, playerId, now);
export const joinDuel = (duel: PvpDuel, name: string, now: number) => joinPvp(rulesOf(duel), duel, name, now);
export const readyDuel = (duel: PvpDuel, playerId: string, ready: boolean, now: number) => readyPvp(rulesOf(duel), duel, playerId, ready, now);
export const leaveDuel = (duel: PvpDuel, playerId: string, now: number) => leavePvp(rulesOf(duel), duel, playerId, now);
export const rematchOf = (old: PvpDuel, code: string, now: number, seed?: string) => rematchPvp(rulesOf(old), old, code, now, seed);
export const takeRematchSeat = (duel: PvpDuel, playerId: string, name: string, now: number): PvpOutcome<PvpDuel> =>
  takeRematchSeatPvp(rulesOf(duel), duel, playerId, name, now);
export const linkRematch = (duel: PvpDuel, code: string): PvpOutcome<PvpDuel> | PvpFailure => linkRematchPvp(duel, code);

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function duelView(duel: PvpDuel, playerId: string | null, now: number, rev: number): PvpView {
  switch (duel.kind) {
    case "pokedle":
      return pokedleView(duel, playerId, now, rev);
  }
}
