import "server-only";
import type { DuelEmote, PvpView } from "@/lib/pvp-types";
import {
  chatPvp,
  emotePvp,
  fail,
  joinPvp,
  leavePvp,
  linkRematchPvp,
  readyPvp,
  rematchPvp,
  takeRematchSeatPvp,
  touchPvp,
  type PvpOutcome,
  type PvpRules,
} from "./duel-core";
import { pokedleRules, pokedleView, skipPokedleReveal, type PokedleDuel } from "./pokedle-duel";
import { quizRules, quizView, skipQuizReveal, type QuizDuel } from "./quiz-duel";

/**
 * Every duel in the shared `duels` table, whatever its game: the lobby,
 * presence and rematch steps from duel-core.ts with each game's own rules,
 * and each game's view. Game moves (a Pokédle guess, a quiz answer) live
 * with their game.
 */

export type PvpDuel = PokedleDuel | QuizDuel;

const RULES: { [K in PvpDuel["kind"]]: PvpRules<Extract<PvpDuel, { kind: K }>> } = {
  pokedle: pokedleRules,
  quiz: quizRules,
};

/** The rules of the duel's game (each kind's rules take its own duels, so a duel always gets its own). */
const rulesOf = <D extends PvpDuel>(duel: D) => RULES[duel.kind] as unknown as PvpRules<D>;

export const touchDuel = <D extends PvpDuel>(duel: D, playerId: string | null, now: number) => touchPvp(rulesOf(duel), duel, playerId, now);
export const joinDuel = <D extends PvpDuel>(duel: D, name: string, now: number) => joinPvp(rulesOf(duel), duel, name, now);
export const readyDuel = <D extends PvpDuel>(duel: D, playerId: string, ready: boolean, now: number) => readyPvp(rulesOf(duel), duel, playerId, ready, now);
export const leaveDuel = <D extends PvpDuel>(duel: D, playerId: string, now: number) => leavePvp(rulesOf(duel), duel, playerId, now);
export const rematchOf = <D extends PvpDuel>(old: D, code: string, now: number, seed?: string) => rematchPvp(rulesOf(old), old, code, now, seed);
export const takeRematchSeat = <D extends PvpDuel>(duel: D, playerId: string, name: string, now: number) =>
  takeRematchSeatPvp(rulesOf(duel), duel, playerId, name, now);
export const emoteDuel = <D extends PvpDuel>(duel: D, playerId: string, emote: DuelEmote, now: number) => emotePvp(rulesOf(duel), duel, playerId, emote, now);
export const chatDuel = <D extends PvpDuel>(duel: D, playerId: string, text: string, now: number) => chatPvp(rulesOf(duel), duel, playerId, text, now);
export const linkRematch = <D extends PvpDuel>(duel: D, code: string) => linkRematchPvp(duel, code);

/** Next round or question, please: once both trainers press it, the reveal ends early. */
export function skipReveal(duel: PvpDuel, playerId: string, index: number, now: number): PvpOutcome<PvpDuel> {
  return duel.kind === "pokedle" ? skipPokedleReveal(duel, playerId, index, now) : skipQuizReveal(duel, playerId, index, now);
}

/** A game's own move, on a duel of that game only. */
export function asKind<K extends PvpDuel["kind"]>(duel: PvpDuel, kind: K, act: (d: Extract<PvpDuel, { kind: K }>) => PvpOutcome<PvpDuel>) {
  return duel.kind === kind ? act(duel as Extract<PvpDuel, { kind: K }>) : fail(400, "That move isn't part of this duel.");
}

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function duelView(duel: PvpDuel, playerId: string | null, now: number, rev: number): PvpView {
  return duel.kind === "pokedle" ? pokedleView(duel, playerId, now, rev) : quizView(duel, playerId, now, rev);
}
