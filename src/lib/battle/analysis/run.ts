import type { Generation } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import type { CalcModule } from "@/lib/battle/calc";
import { loadCalcGenerations } from "@/lib/battle/dex";
import type { LabPool } from "@/lib/battle/lab/pool";
import { isLabGen } from "@/lib/battle/lab/types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import type { ReplayData } from "@/lib/battle/replay";
import { SOURCE_LABELS, type AssumedSet, type SetSource } from "./assume";
import { keyMomentLine, missedKoText, NO_FACTS, riskySwitchText, turnFacts } from "./facts";
import { keySwings, pct, resultPoint, rolloutsFor, swings, winPoint, type WinPoint } from "./maths";
import { parseReplay, type ParsedBattle, type SideIndex } from "./parse";
import { turnSetup } from "./setup";

/**
 * The post-battle analysis, in the browser: the replay read turn by turn,
 * each turn played out many times from where it stood by the Battle Lab's
 * workers (both sides on the Smart strategy), the win chance from the
 * viewer's side with its 95% interval, the biggest swings explained with
 * the damage calc, and every missed KO and risky switch-in. Results are
 * kept per replay and side in this browser.
 */

export const ANALYSIS_VERSION = 2;
/** Aim to finish a typical battle in about this long. */
export const BUDGET_MS = 25_000;
export const MIN_ROLLOUTS = 40;
/** Once the budget is spent, each remaining turn gets only this many, so a long battle on slow hardware still finishes. */
export const OVER_BUDGET_ROLLOUTS = 10;
export const MAX_ROLLOUTS = 300;
/** Rollouts for the first turn, while the pace is unknown. */
const FIRST_ROLLOUTS = 60;

export class AnalysisUnsupported extends Error {}

export interface AnalysisLine {
  turn: number;
  text: string;
  /** Key moments: who was in battle as the turn started, per side, in position order. */
  board?: [BoardMon[], BoardMon[]];
}

/** A Pokémon in battle at the start of a turn. */
export interface BoardMon {
  species: string;
  /** % HP. */
  hp: number;
  status: string;
  /** For its sprite: Showdown id and National Dex number. */
  sprite: { id: string; num: number } | null;
}

/** Who was in battle at the start of turn `t`, per side, in position order (a, then b). */
export function boardAt(parsed: ParsedBattle, t: number): [BoardMon[], BoardMon[]] {
  const state = parsed.turns[t];
  const side = (s: SideIndex): BoardMon[] =>
    state.sides[s].active.flatMap((key) => {
      const m = key ? state.sides[s].team.find((x) => x.key === key) : undefined;
      const dex = m ? Dex.species.get(m.species) : null;
      return m && !m.fainted ? [{ species: m.species, hp: m.hp, status: m.status, sprite: dex?.exists ? { id: dex.id, num: dex.num } : null }] : [];
    });
  return [side(0), side(1)];
}

export interface AnalysisResult {
  version: number;
  id: string;
  viewer: SideIndex;
  players: [string, string];
  /** A double battle (each side has two Pokémon in battle). */
  doubles?: boolean;
  /** Start of each turn, then the result (n = 0). */
  points: WinPoint[];
  keyMoments: AnalysisLine[];
  missedKos: AnalysisLine[];
  riskySwitches: AnalysisLine[];
  /** Where each side's unrevealed details came from, e.g. "Random Battle sets: 6". */
  sources: [Partial<Record<SetSource, number>>, Partial<Record<SetSource, number>>];
  /** Moves that were assumed, not seen, across all sets. */
  assumedMoves: number;
  rollouts: number;
  ms: number;
  workers: number;
  createdAt: number;
}

export interface AnalysisProgress {
  done: number;
  total: number;
  points: WinPoint[];
  stage: "sets" | "rollouts" | "calc";
}

const cacheKey = (id: string, viewer: SideIndex) => `pokeiq:analysis:v${ANALYSIS_VERSION}:${id}:${viewer}`;

export function cachedAnalysis(id: string, viewer: SideIndex): AnalysisResult | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(id, viewer));
    const parsed = raw ? (JSON.parse(raw) as AnalysisResult) : null;
    return parsed?.version === ANALYSIS_VERSION && Array.isArray(parsed.points) ? parsed : null;
  } catch {
    return null;
  }
}

function store(result: AnalysisResult) {
  try {
    window.localStorage.setItem(cacheKey(result.id, result.viewer), JSON.stringify(result));
  } catch {
    // Storage full or blocked: it just won't be kept.
  }
}

const GAME_TYPE_NAMES: Record<string, string> = { triples: "Triple battles", freeforall: "Free-for-all battles", multi: "Multi battles" };

/** Why a log's game type can't be simulated, or null for singles and doubles. */
export function gameTypeReason(gameType: string): string | null {
  if (gameType === "singles" || gameType === "doubles") return null;
  return `${GAME_TYPE_NAMES[gameType] ?? "Battles of this kind"} can't be simulated by the Battle Lab (it plays singles and doubles), so they can't be analysed.`;
}

/** Why a replay can't be analysed, or null if it can: any singles or doubles battle of a generation the Battle Lab plays. */
export function unsupportedReason(replay: Pick<ReplayData, "format" | "turns">): string | null {
  if (replay.turns < 1) return "This battle ended before the first turn, so there's nothing to analyse.";
  const gen = Number(/^gen(\d)/.exec(replay.format)?.[1] ?? 9);
  if (!isLabGen(gen)) return `Gen ${gen} battles can't be simulated by the Battle Lab, so they can't be analysed.`;
  const type = PLAY_FORMAT_INFO[replay.format]?.gameType ?? (/triples/.test(replay.format) ? "triples" : /freeforall/.test(replay.format) ? "freeforall" : /multi/.test(replay.format) ? "multi" : "singles");
  return gameTypeReason(type);
}

let calcLoad: Promise<{ gen: (n: number) => Generation; lib: CalcModule }> | null = null;
function loadCalc() {
  calcLoad ??= Promise.all([import("@smogon/calc/dist/adaptable"), loadCalcGenerations()]).then(([lib, gens]) => ({ lib, gen: (n: number) => gens.get(n) }));
  calcLoad.catch(() => (calcLoad = null));
  return calcLoad;
}

export async function analyseReplay(
  replay: ReplayData,
  viewer: SideIndex,
  pool: LabPool,
  onProgress: (p: AnalysisProgress) => void,
  cancelled: () => boolean
): Promise<AnalysisResult | null> {
  const why = unsupportedReason(replay);
  if (why) throw new AnalysisUnsupported(why);
  const started = performance.now();
  const parsed = parseReplay(replay.log);
  const typeWhy = gameTypeReason(parsed.gameType);
  if (typeWhy) throw new AnalysisUnsupported(typeWhy);
  if (!isLabGen(parsed.gen)) throw new AnalysisUnsupported(`Gen ${parsed.gen} battles can't be simulated by the Battle Lab, so they can't be analysed.`);
  const total = parsed.lastTurn;
  onProgress({ done: 0, total, points: [], stage: "sets" });

  // Fill out what the battle didn't show (the server has the sets data).
  const mons = [...parsed.revealed[0].values(), ...parsed.revealed[1].values()];
  const last = parsed.turns[parsed.lastTurn];
  const unseen = ([0, 1] as const).map((s) => Math.max(0, last.sides[s].size - parsed.revealed[s].size));
  const res = await fetch("/api/battle/analysis/sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: replay.format, mons, unseen, seed: replay.id }),
  });
  const body = (await res.json().catch(() => ({}))) as { sets?: AssumedSet[]; error?: string };
  if (!res.ok || !body.sets) throw new Error(body.error ?? "Couldn't load the sets to simulate with.");
  const sets = new Map(body.sets.map((a) => [a.key, a]));
  const keys: [string[], string[]] = [
    body.sets.filter((a) => a.key.startsWith("p1:")).map((a) => a.key),
    body.sets.filter((a) => a.key.startsWith("p2:")).map((a) => a.key),
  ];

  // Rollouts from the start of every turn.
  const points: WinPoint[] = [];
  let rollouts = 0;
  const seed = `analysis:${replay.id}`;
  for (let t = 1; t <= total; t++) {
    if (cancelled()) return null;
    const setup = turnSetup(parsed.turns[t], parsed.gen, sets, keys, parsed.doubles);
    if (!setup) continue;
    const elapsed = performance.now() - started;
    const n = t === 1 ? FIRST_ROLLOUTS : rolloutsFor({ budgetMs: BUDGET_MS, elapsedMs: elapsed, turnsLeft: total - t + 1, msPerRollout: rollouts ? elapsed / rollouts : 0, min: elapsed > BUDGET_MS ? OVER_BUDGET_ROLLOUTS : MIN_ROLLOUTS, max: MAX_ROLLOUTS });
    const run = pool.run(setup, seed, n, () => cancelled() && run.cancel());
    const out = await run.promise;
    if (cancelled()) return null;
    rollouts += out.done;
    points.push(winPoint(t, out.totals, viewer));
    onProgress({ done: t, total, points: [...points], stage: "rollouts" });
  }
  points.push(resultPoint(total + 1, replay.winner, viewer));

  // The calc's facts, and the lines.
  onProgress({ done: total, total, points: [...points], stage: "calc" });
  const { lib, gen } = await loadCalc();
  const calc = { lib, gen: gen(parsed.gen) };
  const facts = Array.from({ length: total + 1 }, (_, t) => (t ? turnFacts(calc, parsed, t, viewer, sets) : NO_FACTS));
  const allSwings = swings(points);
  const swingAt = new Map(allSwings.map((s) => [s.turn, s]));
  const change = (t: number) => {
    const s = swingAt.get(t);
    return s ? ` (win chance ${pct(s.before.p)} → ${s.after.n ? pct(s.after.p) : s.after.p === 1 ? "won" : s.after.p === 0 ? "lost" : "draw"})` : "";
  };
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sources: AnalysisResult["sources"] = [{}, {}];
  let assumedMoves = 0;
  for (const a of body.sets) {
    const side = a.key.startsWith("p1:") ? 0 : 1;
    sources[side][a.source] = (sources[side][a.source] ?? 0) + 1;
    assumedMoves += a.set.moves.length - a.revealedMoves;
  }
  const result: AnalysisResult = {
    version: ANALYSIS_VERSION,
    id: replay.id,
    viewer,
    players: replay.players,
    ...(parsed.doubles ? { doubles: true } : {}),
    points,
    keyMoments: keySwings(allSwings).map((s) => ({ turn: s.turn, text: keyMomentLine(parsed, viewer, s, facts[s.turn]), board: boardAt(parsed, s.turn) })),
    missedKos: facts.flatMap((f, t) => f.missedKos.map((m) => ({ turn: t, text: `Turn ${t}: ${capital(missedKoText(parsed, viewer, m))}${change(t)}.` }))),
    riskySwitches: facts.flatMap((f, t) => f.riskySwitches.map((r) => ({ turn: t, text: `Turn ${t}: ${capital(riskySwitchText(r))}${change(t)}.` }))),
    sources,
    assumedMoves,
    rollouts,
    ms: Math.round(performance.now() - started),
    workers: pool.size,
    createdAt: Date.now(),
  };
  store(result);
  return result;
}

/** "Random Battle sets (5), a stand-in for a Pokémon that never appeared (1)". */
export function sourceText(counts: Partial<Record<SetSource, number>>): string {
  return (Object.entries(counts) as [SetSource, number][]).map(([s, n]) => `${SOURCE_LABELS[s]} (${n})`).join(", ");
}
