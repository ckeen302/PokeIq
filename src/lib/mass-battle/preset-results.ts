import type { BattleOutcome } from "./types";

/** The presets' precomputed results (src/data/mass-battle-presets.json, from scripts/mass-battle-presets.ts). */

export interface PresetAnswer {
  n: number;
  spread: number;
  wins: number;
  runs: number;
  /** The battle at the answer the page shows (one the army won). */
  seed: number;
}

export interface PresetResult {
  outcome: BattleOutcome;
  answer: PresetAnswer | null;
}

export interface PresetsFile {
  /** Bumped when the engine's rules change (results must be regenerated). */
  engine: number;
  roster: number;
  results: Record<string, PresetResult>;
}

/** The battle rules' version: change it with any change to the simulation that changes outcomes. */
export const ENGINE_VERSION = 3;

export const presetsFile = (roster: number, results: Record<string, PresetResult>): PresetsFile => ({ engine: ENGINE_VERSION, roster, results });
