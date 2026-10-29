/**
 * PokéGuessr duel history and replays, client safe: what /api/geo/history
 * returns (lib/server/geo-duel-history.ts keeps the duels) and the replay
 * page's step maths.
 */

import type { DuelEndReason, DuelMode, DuelRoundResult } from "./duel-types";
import type { GeoEra } from "./geo-families";

/** A kept duel's public facts. */
export interface GeoDuelSummary {
  region: string;
  era?: GeoEra;
  mode: DuelMode;
  turbo?: boolean;
  ranked: boolean;
  players: { name: string; bot?: boolean }[];
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  reason: DuelEndReason;
  /** HP at the end, by seat. */
  hp: number[];
  /** A points race's totals, by seat. */
  totals?: number[];
  /** A ranked duel: each seat's Elo before and after. */
  elo?: { before: [number, number]; after: [number, number] };
}

/** One duel in a trainer's history, from their seat. */
export interface GeoDuelHistoryItem {
  code: string;
  endedAt: number;
  ranked: boolean;
  mode: DuelMode;
  region: string;
  turbo?: boolean;
  opponent: { name: string; bot?: boolean };
  result: "win" | "loss" | "draw";
  /** HP at the end: [yours, theirs]. */
  hp: [number, number];
  /** A points race: [yours, theirs]. */
  totals?: [number, number];
  /** A ranked duel: your Elo before and after. */
  elo?: { before: number; after: number };
  public: boolean;
}

export type GeoDuelHistoryResponse =
  | { available: false; id?: string }
  | { available: true; id?: string; duels: GeoDuelHistoryItem[]; /** Pass as ?before= for the next page; null at the end. */ next: number | null };

/** A replay: the summary, every revealed round, and the viewer's seat (null: someone viewing a shared replay). */
export interface GeoDuelReplay extends GeoDuelSummary {
  code: string;
  endedAt: number;
  rounds: DuelRoundResult[];
  you: number | null;
  public: boolean;
}

/**
 * The replay's steps: each round is shown in phases — the shot, then the
 * pins and the true place, then the damage landing — so playing it reads
 * like the duel did. Step `s` is round floor(s / 3), phase s % 3.
 */
export const REPLAY_PHASES = ["shot", "pins", "damage"] as const;
export type ReplayPhase = (typeof REPLAY_PHASES)[number];

export const replaySteps = (rounds: number) => Math.max(0, rounds * REPLAY_PHASES.length);

export function replayStep(step: number, rounds: number): { round: number; phase: ReplayPhase } {
  const last = Math.max(0, replaySteps(rounds) - 1);
  const s = Math.min(Math.max(0, Math.floor(step)), last);
  return { round: Math.floor(s / REPLAY_PHASES.length), phase: REPLAY_PHASES[s % REPLAY_PHASES.length] };
}

/** HP shown at a step: before the round until its damage lands, after it from then on. */
export function replayHp(round: Pick<DuelRoundResult, "hpBefore" | "hp">, phase: ReplayPhase): number[] {
  return phase === "damage" ? round.hp : round.hpBefore;
}
