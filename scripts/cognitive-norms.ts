import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulateNorms } from "../src/lib/cognitive/simulate";

/**
 * Writes the seeded norms for the Cognitive PokéIQ test
 * (src/data/cognitive-norms.json): 10,000 synthetic trainers simulated with
 * a fixed seed. See src/lib/cognitive/simulate.ts for the model. Run with
 * `npx tsx scripts/cognitive-norms.ts`.
 */

const SEED = "pokeiq-cognitive-norms-v1";
const N = 10_000;

const norms = simulateNorms(SEED, N);
const out = join(process.cwd(), "src/data/cognitive-norms.json");
writeFileSync(out, JSON.stringify({ ...norms, generated: new Date().toISOString().slice(0, 10) }, null, 0) + "\n");
console.log(`wrote ${out}: n=${N}, seed=${SEED}`);
for (const [k, t] of Object.entries(norms.sections)) {
  const median = t.cdf.findIndex((c) => c >= 0.5);
  const p90 = t.cdf.findIndex((c) => c >= 0.9);
  console.log(`  ${k}: median raw ${median}, 90th ${p90}, max ${t.cdf.length - 1}`);
}
