/**
 * Writes tests/fixtures/analysis-doubles.json: Gen 9 Random Doubles Battles
 * played to the end on Pokémon Showdown's simulator by two computer players
 * on Hard (the doubles policy), each as a replay stores it (the spectator
 * channel). The doubles analysis tests read them.
 *
 *   npx tsx scripts/doubles-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { selfPlay } from "../tests/helpers/selfplay";

const SEEDS = [11, 23, 37];
const battles = SEEDS.map((n) => {
  const b = selfPlay("gen9randomdoublesbattle", n);
  if (b.refused.length) throw new Error(`battle ${n}: refused ${b.refused.join("; ")}`);
  console.log(`seed ${n}: ${b.turns} turns, winner ${b.winner === null ? "none" : b.players[b.winner]}, ${b.log.length} lines`);
  return { seed: n, format: b.format, players: b.players, winner: b.winner, turns: b.turns, log: b.log };
});
writeFileSync(new URL("../tests/fixtures/analysis-doubles.json", import.meta.url), `${JSON.stringify(battles)}\n`);
