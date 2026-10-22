import type { Generation } from "@pkmn/data";
import type { CalcModule } from "@/lib/battle/calc";
import { loadCalcGenerations } from "@/lib/battle/dex";
import type { LabPool } from "@/lib/battle/lab/pool";
import { isLabGen } from "@/lib/battle/lab/types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import type { ReplayData } from "@/lib/battle/replay";
import { SOURCE_LABELS, type AssumedSet, type SetSource } from "./assume";
import { keyMomentLine, missedKoText, riskySwitchText, turnFacts } from "./facts";
import { keySwings, pct, resultPoint, rolloutsFor, swings, winPoint, type WinPoint } from "./maths";
import { parseReplay, type SideIndex } from "./parse";
import { turnSetup } from "./setup";

/**
 * The post-battle analysis, in the browser: the replay read turn by turn,
 * each turn played out many times from where it stood by the Battle Lab's
 * workers (both sides on the Smart strategy), the win chance from the
 * viewer's side with its 95% interval, the biggest swings explained with
 * the damage calc, and every missed KO and risky switch-in. Results are
 * kept per replay and side in this browser.
 */

export const ANALYSIS_VERSION = 1;
/** Aim to finish a typical battle in about this long. */
export const BUDGET_MS = 25_000;
export const MIN_ROLLOUTS = 60;
export const MAX_ROLLOUTS = 300;
/** Rollouts for the first turn, while the pace is unknown. */
const FIRST_ROLLOUTS = 80;

export class AnalysisUnsupported extends Error {}

export interface AnalysisLine {
  turn: number;
  text: string;
}

export interface AnalysisResult {
  version: number;
  id: string;
  viewer: SideIndex;
  players: [string, string];
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

/** Why a replay can't be analysed (yet), or null if it can. */
export function unsupportedReason(replay: Pick<ReplayData, "format" | "turns">): string | null {
  if (PLAY_FORMAT_INFO[replay.format]?.gameType === "doubles") return "Analysis for double battles is coming soon.";
  if (replay.turns < 1) return "This battle ended before the first turn, so there's nothing to analyse.";
  return null;
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
  if (parsed.doubles) throw new AnalysisUnsupported("Analysis for double battles is coming soon.");
  if (!isLabGen(parsed.gen)) throw new AnalysisUnsupported(`Gen ${parsed.gen} battles can't be simulated.`);
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
    const setup = turnSetup(parsed.turns[t], parsed.gen, sets, keys);
    if (!setup) continue;
    const elapsed = performance.now() - started;
    const n = t === 1 ? FIRST_ROLLOUTS : rolloutsFor({ budgetMs: BUDGET_MS, elapsedMs: elapsed, turnsLeft: total - t + 1, msPerRollout: rollouts ? elapsed / rollouts : 0, min: MIN_ROLLOUTS, max: MAX_ROLLOUTS });
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
  const facts = Array.from({ length: total + 1 }, (_, t) => (t ? turnFacts(calc, parsed, t, viewer, sets) : { missedKo: null, riskySwitch: null }));
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
    points,
    keyMoments: keySwings(allSwings).map((s) => ({ turn: s.turn, text: keyMomentLine(parsed, viewer, s, facts[s.turn]) })),
    missedKos: facts.flatMap((f, t) => (f.missedKo ? [{ turn: t, text: `Turn ${t}: ${missedKoText(parsed, viewer, f.missedKo)}${change(t)}.` }] : [])),
    riskySwitches: facts.flatMap((f, t) => (f.riskySwitch ? [{ turn: t, text: `Turn ${t}: ${capital(riskySwitchText(f.riskySwitch))}${change(t)}.` }] : [])),
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
