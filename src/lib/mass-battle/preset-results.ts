import type { BattleOutcome } from "./types";

/** The presets' precomputed results (src/data/mass-battle-presets.json, from scripts/mass-battle-presets.ts). */

export interface PresetAnswer {
  n: number;
  spread: number;
  wins: number;
  runs: number;
  /** The battle at the answer the page shows (one the army won). */
  seed: number;
  /** The pure battle maths: the answer with everyone in reach of everyone (no battlefield), as the simulator check plays it. */
  pure?: PureAnswer | null;
}

export interface PureAnswer {
  n: number;
  spread: number;
  wins: number;
  runs: number;
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
export const ENGINE_VERSION = 4;

export const presetsFile = (roster: number, results: Record<string, PresetResult>): PresetsFile => ({ engine: ENGINE_VERSION, roster, results });
