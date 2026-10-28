import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rng } from "@/lib/rng";
import { POOL } from "@/lib/which-pokemon/pool";
import { rankPool } from "@/lib/which-pokemon/match";
import { simulateBalance, simulateRun } from "@/lib/which-pokemon/simulate";
import type { Profile } from "@/lib/which-pokemon/types";

/**
 * Calibrates the result pool against realistic simulated players so that
 * every pooled Pokémon is reachable and none is too common.
 *
 * Phase A nudges each profile toward the players who already match it best
 * (a bounded Lloyd step: never more than NUDGE points from the hand-set
 * profile, which is kept in `hand`), which pulls near-twins apart and moves
 * profiles into the regions players actually occupy. Phase B then tunes a
 * small per-Pokémon distance bias (±BIAS points) to even out the remaining
 * win shares. Both are written back into src/data/which-pokemon.json; the
 * rationale and write-ups are untouched. tests/which-pokemon.test.ts checks
 * the committed result with a fixed seed.
 *
 *   npx tsx scripts/which-pokemon-tune.ts [nudgeRounds] [biasRounds] [runsPerRound]
 */

const nudgeRounds = Number(process.argv[2] ?? 12);
const biasRounds = Number(process.argv[3] ?? 30);
const runs = Number(process.argv[4] ?? 8000);
const NUDGE = 8;
const BIAS = 10;
const LO = 0.002;
const HI = 0.02;

const file = join(process.cwd(), "src/data/which-pokemon.json");
const data = JSON.parse(readFileSync(file, "utf8")) as { axes: string[]; pokemon: { id: number; slug: string; p: number[]; hand?: number[]; bias?: number }[] };
const byId = new Map(data.pokemon.map((p) => [p.id, p]));
for (const p of data.pokemon) p.hand ??= [...p.p];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const setProfile = (id: number, p: number[]) => {
  const rounded = p.map((v) => Math.round(v));
  byId.get(id)!.p = rounded;
  (POOL.find((x) => x.id === id)! as { p: Profile }).p = rounded as unknown as Profile;
};

function report(label: string, seed: string) {
  const r = simulateBalance(runs, seed);
  const under = [...r.wins.values()].filter((w) => w / runs < LO).length;
  const over = [...r.wins.values()].filter((w) => w / runs > HI).length;
  console.log(`${label}: max ${(r.maxShare * 100).toFixed(2)}%, min ${(r.minShare * 100).toFixed(2)}%, under ${LO * 100}%: ${under}, over ${HI * 100}%: ${over}, stability ${(r.stability * 100).toFixed(1)}%`);
  return r;
}

// Phase A: bounded Lloyd steps on the profiles.
for (let round = 0; round < nudgeRounds; round++) {
  const rng = new Rng(`nudge-${round}`);
  const top = new Map<number, number[][]>();
  const near = new Map<number, number[][]>();
  for (let i = 0; i < runs; i++) {
    const { result } = simulateRun(rng);
    const s = [...result.scores];
    top.set(result.top.pokemon.id, [...(top.get(result.top.pokemon.id) ?? []), s]);
    for (const m of rankPool(result.scores).slice(0, 6)) near.set(m.pokemon.id, [...(near.get(m.pokemon.id) ?? []), s]);
  }
  let moved = 0;
  for (const p of POOL) {
    const won = top.get(p.id) ?? [];
    // A starved Pokémon follows the players it nearly matched; the rest settle on their own winners.
    const pull = won.length >= 12 ? won : (near.get(p.id) ?? []);
    if (pull.length < 4) continue;
    const hand = byId.get(p.id)!.hand!;
    const centroid = p.p.map((_, a) => pull.reduce((sum, s) => sum + s[a], 0) / pull.length);
    const rate = won.length >= 12 ? 0.3 : 0.6;
    const next = p.p.map((v, a) => clamp(v + rate * (centroid[a] - v), hand[a] - NUDGE, hand[a] + NUDGE));
    if (next.some((v, a) => Math.round(v) !== p.p[a])) moved++;
    setProfile(p.id, next);
  }
  console.log(`nudge ${round + 1}: ${moved} profiles moved`);
}
report("after nudging", "after-nudge");

// Phase B: bias potentials, with momentum to damp oscillation.
const velocity = new Map<number, number>();
for (let round = 0; round < biasRounds; round++) {
  const r = simulateBalance(runs, `bias-${round}`);
  const mean = 1 / POOL.length;
  for (const p of POOL) {
    const share = (r.wins.get(p.id) ?? 0) / runs;
    const step = 1.5 * Math.log((share + 0.0008) / mean);
    const v = 0.5 * (velocity.get(p.id) ?? 0) + step;
    velocity.set(p.id, v);
    const bias = Math.round(clamp((p.bias ?? 0) + v, -BIAS, BIAS) * 10) / 10;
    p.bias = bias;
    byId.get(p.id)!.bias = bias;
  }
  const under = [...r.wins.values()].filter((w) => w / runs < LO).length;
  console.log(`bias ${round + 1}: max ${(r.maxShare * 100).toFixed(2)}%, min ${(r.minShare * 100).toFixed(2)}%, under ${LO * 100}%: ${under}`);
  if (r.maxShare <= HI && r.minShare >= LO && round >= 4) break;
}

writeFileSync(file, JSON.stringify(data, null, 0).replace(/\{"id"/g, '\n{"id"') + "\n");
const final = simulateBalance(20_000, "which-pokemon");
const sorted = [...final.wins.entries()].sort((a, b) => b[1] - a[1]);
console.log(`final (seed which-pokemon, 20,000 runs): max ${(final.maxShare * 100).toFixed(2)}%, min ${(final.minShare * 100).toFixed(2)}%, stability ${(final.stability * 100).toFixed(1)}%`);
console.log("top:", sorted.slice(0, 6).map(([id, w]) => `${byId.get(id)!.slug} ${((w / final.runs) * 100).toFixed(2)}%`).join(", "));
console.log("bottom:", sorted.slice(-6).map(([id, w]) => `${byId.get(id)!.slug} ${((w / final.runs) * 100).toFixed(2)}%`).join(", "));
