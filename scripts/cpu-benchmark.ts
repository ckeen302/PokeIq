/**
 * The computer opponent's strength: whole Gen 9 Random Battles on the Battle
 * Lab's simulator between the policies, from mirrored random teams (each team
 * pairing is played twice with the sides swapped), with the time each policy
 * takes per decision.
 *
 *   npx tsx scripts/cpu-benchmark.ts                       (1,000 games per matchup, all cores)
 *   npx tsx scripts/cpu-benchmark.ts --games 200 --seed 3 --only hard-vs-legacy
 *
 * --tune takes the lookahead's TUNE weights and the doubles policy's DOUBLES_TUNE.
 *
 * Matchups: hard-vs-legacy (the lookahead against the old Hard policy in
 * cpu-policy-legacy.ts), hard-vs-normal, normal-vs-easy, and in Gen 9 Random
 * Doubles Battles doubles-vs-legacy (cpu-policy-doubles.ts on Hard against
 * the old heuristic) and doubles-hard-vs-normal.
 */
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { Teams } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import type { Battle, Side } from "@pkmn/sim";
import { chooseCpu, TUNE } from "@/lib/battle/cpu-policy";
import { DOUBLES_TUNE } from "@/lib/battle/cpu-policy-doubles";
import { chooseCpuLegacy } from "@/lib/battle/cpu-policy-legacy";
import { withMega, type Chooser } from "@/lib/battle/lab/policies";
import { defaultSetup, emptySide, labMon } from "@/lib/battle/lab/setup";
import { prepareLab, runLabBattle } from "@/lib/battle/lab/simulate";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";
import { completeSet } from "@/lib/battle/sets";
import type { LabMon } from "@/lib/battle/lab/types";

Teams.setGeneratorFactory(TeamGenerators);

type Policy = "hard" | "normal" | "easy" | "legacy";
const MATCHUPS: Record<string, [Policy, Policy]> = {
  "hard-vs-legacy": ["hard", "legacy"],
  "hard-vs-normal": ["hard", "normal"],
  "normal-vs-easy": ["normal", "easy"],
  "doubles-vs-legacy": ["hard", "legacy"],
  "doubles-hard-vs-normal": ["hard", "normal"],
};
const isDoubles = (matchup: string) => matchup.startsWith("doubles-");

interface Job {
  tune: Record<string, number>;
  matchup: string;
  games: number;
  seed: string;
  from: number;
  to: number;
}

interface Result {
  wins: [number, number];
  draws: number;
  turns: number;
  refused: number;
  fallbacks: number;
  broken: number;
  /** Think times in ms, per policy of the matchup. */
  times: [number[], number[]];
}

const FORMAT = "gen9randombattle";
const DOUBLES_FORMAT = "gen9randomdoublesbattle";

function team(seed: string, format = FORMAT): LabMon[] {
  return Teams.generate(format, { seed: seed as never }).map((s) => labMon(completeSet({ ...s, species: s.species, nature: s.nature || "" })));
}

function policyChooser(policy: Policy, rand: () => number, times: number[], onFallback: () => void): Chooser {
  const level: CpuLevel = policy === "legacy" ? "hard" : policy;
  return (battle: Battle, side: Side) => {
    const request = side.activeRequest as unknown as BattleRequest;
    const t0 = performance.now();
    const choice = policy === "legacy" ? chooseCpuLegacy(battle, side, level, rand, onFallback) : chooseCpu(battle, side, level, rand, onFallback);
    times.push(performance.now() - t0);
    return withMega(choice, request);
  };
}

/** Games `from` to `to` of a matchup: game 2k and 2k+1 share a team pairing with the sides swapped. */
function runJob(job: Job): Result {
  // Weights of either policy (the doubles one's names don't clash with the lookahead's).
  for (const [k, v] of Object.entries(job.tune)) Object.assign(k in DOUBLES_TUNE ? DOUBLES_TUNE : TUNE, { [k]: v });
  const [a, b] = MATCHUPS[job.matchup];
  const out: Result = { wins: [0, 0], draws: 0, turns: 0, refused: 0, fallbacks: 0, broken: 0, times: [[], []] };
  for (let g = job.from; g < job.to; g++) {
    const pairing = Math.floor(g / 2);
    const swapped = g % 2 === 1;
    const seedA = `${job.seed}-${pairing}-a`;
    const seedB = `${job.seed}-${pairing}-b`;
    const doubles = isDoubles(job.matchup);
    const format = doubles ? DOUBLES_FORMAT : FORMAT;
    const teams = [team(hashSeed(seedA), format), team(hashSeed(seedB), format)];
    const setup = { ...defaultSetup(), gen: 9 as const, doubles, sides: [{ ...emptySide(), team: teams[swapped ? 1 : 0] }, { ...emptySide(), team: teams[swapped ? 0 : 1] }] as never };
    const prep = prepareLab(setup);
    // The random-battle format, so the policies know the sets its generator hands out.
    prep.formatid = format;
    const policies: [Policy, Policy] = swapped ? [b, a] : [a, b];
    const { record } = runLabBattle(prep, `${job.seed}:${job.matchup}`, g, {
      choosers: (rands, rec) => [
        policyChooser(policies[0], rands[0], out.times[swapped ? 1 : 0], () => rec.fallbacks++),
        policyChooser(policies[1], rands[1], out.times[swapped ? 0 : 1], () => rec.fallbacks++),
      ],
    });
    if (record.outcome === 2) out.draws++;
    else out.wins[(record.outcome === 0) !== swapped ? 0 : 1]++;
    out.turns += record.turns;
    out.refused += record.refused;
    out.fallbacks += record.fallbacks;
    if (record.broken) out.broken++;
  }
  return out;
}

/** The team generator wants a "a,b,c,d" of 16-bit numbers. */
function hashSeed(s: string): string {
  let h = 2166136261;
  const parts: number[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    parts.push((h >>> 0) % 65536);
  }
  return parts.join(",");
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const games = Math.max(2, Math.ceil(Number(arg("games", "1000")) / 2) * 2);
  const seed = arg("seed", "bench");
  const only = arg("only", "");
  const workers = Math.max(1, Math.min(cpus().length, Number(arg("workers", String(cpus().length)))));
  const matchups = only ? [only] : Object.keys(MATCHUPS);
  // --tune key=value,key=value: evaluation weights to try (see TUNE in cpu-policy.ts).
  const tune: Record<string, number> = {};
  for (const kv of arg("tune", "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    if (!(k in TUNE || k in DOUBLES_TUNE) || !Number.isFinite(Number(v))) throw new Error(`Unknown weight ${kv}; one of ${[...Object.keys(TUNE), ...Object.keys(DOUBLES_TUNE)].join(", ")}`);
    tune[k] = Number(v);
  }
  if (Object.keys(tune).length) console.log(`weights: ${JSON.stringify(tune)}`);
  for (const matchup of matchups) {
    if (!MATCHUPS[matchup]) throw new Error(`Unknown matchup ${matchup}. One of: ${Object.keys(MATCHUPS).join(", ")}`);
    const t0 = performance.now();
    // Pairings stay together (even game counts per chunk), so every team pairing is played both ways.
    const chunk = Math.ceil(games / workers / 2) * 2;
    const jobs: Job[] = [];
    for (let from = 0; from < games; from += chunk) jobs.push({ tune, matchup, games, seed, from, to: Math.min(games, from + chunk) });
    const results = await Promise.all(jobs.map((job) => (workers > 1 ? runInWorker(job) : Promise.resolve(runJob(job)))));
    const total: Result = { wins: [0, 0], draws: 0, turns: 0, refused: 0, fallbacks: 0, broken: 0, times: [[], []] };
    for (const r of results) {
      total.wins[0] += r.wins[0];
      total.wins[1] += r.wins[1];
      total.draws += r.draws;
      total.turns += r.turns;
      total.refused += r.refused;
      total.fallbacks += r.fallbacks;
      total.broken += r.broken;
      total.times[0].push(...r.times[0]);
      total.times[1].push(...r.times[1]);
    }
    const [a, b] = MATCHUPS[matchup];
    const decided = total.wins[0] + total.wins[1];
    const pct = (n: number) => `${((100 * n) / Math.max(1, decided)).toFixed(1)}%`;
    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`\n${matchup}: ${games} games, ${secs}s on ${workers} thread(s), mean ${(total.turns / games).toFixed(1)} turns, ${total.draws} draws, ${total.refused} refused, ${total.fallbacks} fallbacks, ${total.broken} broken`);
    console.log(`  ${a.padEnd(7)} wins ${String(total.wins[0]).padStart(5)}  ${pct(total.wins[0])} of decided games`);
    console.log(`  ${b.padEnd(7)} wins ${String(total.wins[1]).padStart(5)}  ${pct(total.wins[1])}`);
    for (const [i, p] of [a, b].entries()) {
      const t = total.times[i];
      console.log(`  ${p.padEnd(7)} think time: median ${quantile(t, 0.5).toFixed(1)} ms, p90 ${quantile(t, 0.9).toFixed(1)} ms, p99 ${quantile(t, 0.99).toFixed(1)} ms, max ${quantile(t, 1).toFixed(0)} ms (${t.length} decisions)`);
    }
  }
}

function runInWorker(job: Job): Promise<Result> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: job, execArgv: ["--require", "tsx/cjs"] });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited with ${code}`));
    });
  });
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  parentPort!.postMessage(runJob(workerData as Job));
}
