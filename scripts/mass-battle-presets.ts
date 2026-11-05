/**
 * Precomputes the Mass Battle presets' results for the server-rendered
 * pages (search engines, and browsers without WebGL): each preset's battle
 * played headless with its own seed, and for the "how many?" presets the
 * solver's answer with its spread and the battle the page shows.
 *
 *   npx tsx scripts/mass-battle-presets.ts
 *
 * Writes src/data/mass-battle-presets.json. The same engine and seeds run
 * in the browser, so the page replays exactly these battles; a unit test
 * checks the file still matches the engine.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRoster } from "../src/lib/mass-battle/roster-data";
import { DamageTable } from "../src/lib/mass-battle/damage";
import { prepare, runHeadless } from "../src/lib/mass-battle/engine";
import { PRESETS, resolvePreset } from "../src/lib/mass-battle/presets";
import { questionKey, questionSpec, runsOf, thresholdOf, type SlugIndex } from "../src/lib/mass-battle/share";
import { expandQuestion, factsOf } from "../src/lib/mass-battle/sets";
import { solve, SOLVER, type Evaluate } from "../src/lib/mass-battle/solver";
import type { Question } from "../src/lib/mass-battle/types";
import { presetsFile, type PresetResult } from "../src/lib/mass-battle/preset-results";

const roster = buildRoster();
const bySlug = new Map(roster.species.map((s) => [s.slug, s.id]));
const byId = new Map(roster.species.map((s) => [s.id, s.slug]));
export const SLUGS: SlugIndex = { id: (s) => bySlug.get(s), slug: (id) => byId.get(id) };

/** Plays a question's battles in this process, keeping each fighter list's damage table (as the browser's workers do); groups are spelled out first, as the page does. */
export function evaluator(question: Question, layout: "field" | "melee" = "field"): Evaluate {
  const q = expandQuestion(question, roster.species.map(factsOf));
  const tables = new Map<number, DamageTable>();
  const cache = new Map<string, number>();
  return async (n, seeds, settled) => {
    let wins = 0, losses = 0;
    const wonSeeds: number[] = [], lostSeeds: number[] = [];
    for (const seed of seeds) {
      const key = `${n}:${seed}`;
      let w = cache.get(key);
      if (w === undefined) {
        const prep = prepare(roster, questionSpec(q, n, seed), { layout });
        let table = tables.get(prep.species.length);
        if (!table) {
          table = new DamageTable(prep.species.map((species, k) => ({ species, set: prep.sets[k] })), prep.field);
          tables.set(prep.species.length, table);
        }
        w = runHeadless(prep, table).winner;
        cache.set(key, w);
      }
      if (w === 0) { wins++; wonSeeds.push(seed); } else { losses++; lostSeeds.push(seed); }
      if (settled(wins, losses)) break;
    }
    return { wins, runs: wins + losses, wonSeeds, lostSeeds };
  };
}

/** `--rules pp` or `--rules noff`: the "how many?" answers with Real PP on, or friendly fire off, against the saved ones (nothing is written). */
async function compareRules(which: string) {
  const saved = (await import("../src/data/mass-battle-presets.json")).default as unknown as { results: Record<string, PresetResult> };
  for (const p of PRESETS) {
    const r = resolvePreset(p, roster);
    if (!r.question) continue;
    const q: Question = { ...r.question, rules: which === "pp" ? { pp: true } : { friendlyFire: false } };
    const s = await solve(questionKey(r.question, SLUGS), evaluator(q), undefined, { runs: runsOf(q), threshold: thresholdOf(q) });
    const was = saved.results[p.id]?.answer;
    console.log(`${p.id}: ${was ? `${was.n} ± ${was.spread}` : "—"} → ${which === "pp" ? "Real PP" : "no friendly fire"} ${s.answer ?? "none"} ± ${s.spread} (${s.wins}/${s.runs})`);
  }
}

async function main() {
  const ri = process.argv.indexOf("--rules");
  if (ri >= 0) return compareRules(process.argv[ri + 1]);
  const results: Record<string, PresetResult> = {};
  for (const p of PRESETS) {
    const r = resolvePreset(p, roster);
    const t0 = Date.now();
    const b = runHeadless(prepare(roster, r.spec));
    const res: PresetResult = { outcome: b.outcome(), answer: null };
    if (r.question) {
      const q = r.question;
      const s = await solve(questionKey(q, SLUGS), evaluator(q), undefined, { runs: runsOf(q), threshold: thresholdOf(q) });
      res.answer = s.answer === null ? null : { n: s.answer, spread: s.spread, wins: s.wins, runs: s.runs, seed: s.wonSeed ?? r.spec.seed };
      // The pure battle maths: everyone in reach of everyone (the simulator check's model), on its own seeds.
      if (res.answer) {
        const pure = await solve(`${questionKey(q, SLUGS)}#pure`, evaluator(q, "melee"), undefined, { runs: runsOf(q), threshold: thresholdOf(q), maxN: SOLVER.pureMaxN });
        res.answer.pure = pure.answer === null ? { n: 0, spread: 0, wins: 0, runs: 0 } : { n: pure.answer, spread: pure.spread, wins: pure.wins, runs: pure.runs };
      }
    }
    results[p.id] = res;
    console.log(`${p.id}: winner ${res.outcome.winner}, ${res.outcome.seconds.toFixed(1)} s, left ${res.outcome.left.join("/")}${res.answer ? `; answer ${res.answer.n} ± ${res.answer.spread} (${res.answer.wins}/${res.answer.runs}), pure ${res.answer.pure?.n ?? "—"} ± ${res.answer.pure?.spread ?? "—"}` : ""} [${Date.now() - t0} ms]`);
  }
  const out = presetsFile(roster.version, results);
  writeFileSync(join(__dirname, "../src/data/mass-battle-presets.json"), `${JSON.stringify(out, null, 1)}\n`);
}

if (process.argv[1]?.endsWith("mass-battle-presets.ts")) void main();
