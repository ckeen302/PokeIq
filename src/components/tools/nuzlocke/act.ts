import type { EncounterKind } from "@/lib/nuzlocke/model";
import type { Death, MonStatus, Rules } from "@/lib/nuzlocke/run";

/** What the run screen's parts can do to the run (RunApp carries them out, each through lib/nuzlocke/run). */
export interface Act {
  pick(area: string, extra?: boolean): void;
  caught(area: string, mon: string, kind: EncounterKind, shiny: boolean): void;
  failed(area: string, mon?: string): void;
  skip(area: string): void;
  reopen(area: string, thenPick?: boolean): void;
  rename(id: string, nick: string): void;
  status(id: string, status: MonStatus): void;
  dead(id: string, death: Omit<Death, "at">): void;
  swap(into: string, out: string): void;
  evolve(id: string, to: string): void;
  level(id: string, level: number | null): void;
  shiny(id: string, on: boolean): void;
  remove(id: string): void;
  move(id: string, to: number): void;
  boss(key: string): void;
  badge(up: boolean): void;
  rules(rules: Rules): void;
  renameRun(name: string): void;
}
