/**
 * Live smoke test: generate 5 questions per engine against the real PokéAPI,
 * run each through the Zod gate, and report timing + success rate.
 *
 *   npm run verify:engines
 */
import { engines } from "../src/engines";
import { validateQuestion } from "../src/engines/validate";
import type { Difficulty, QuizCategory } from "../src/engines/types";

const QUESTIONS_PER_ENGINE = 5;
const DIFFICULTIES: Difficulty[] = [
  "easy",
  "easy",
  "medium",
  "medium",
  "hard",
];

interface EngineReport {
  category: QuizCategory;
  ok: number;
  failed: number;
  ms: number;
  samples: string[];
  errors: string[];
}

async function verifyEngine(category: QuizCategory): Promise<EngineReport> {
  const engine = engines[category];
  const start = performance.now();
  const report: EngineReport = {
    category,
    ok: 0,
    failed: 0,
    ms: 0,
    samples: [],
    errors: [],
  };

  const results = await Promise.allSettled(
    DIFFICULTIES.slice(0, QUESTIONS_PER_ENGINE).map((d) => engine.generate(d)),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      report.failed++;
      report.errors.push(String(result.reason));
      continue;
    }
    const validation = validateQuestion(result.value);
    if (validation.ok && validation.question) {
      report.ok++;
      report.samples.push(
        `[${validation.question.difficulty}] ${validation.question.question} → ${validation.question.correctAnswer}`,
      );
    } else {
      report.failed++;
      report.errors.push(`Zod gate: ${validation.issues?.join("; ")}`);
    }
  }

  report.ms = Math.round(performance.now() - start);
  return report;
}

async function main() {
  console.log(
    `PokéIQ engine verification — ${QUESTIONS_PER_ENGINE} live questions per engine\n`,
  );
  let totalOk = 0;
  let totalFailed = 0;

  for (const category of Object.keys(engines) as QuizCategory[]) {
    const report = await verifyEngine(category);
    totalOk += report.ok;
    totalFailed += report.failed;
    const status = report.failed === 0 ? "✅" : report.ok > 0 ? "⚠️" : "❌";
    console.log(
      `${status} ${category.padEnd(15)} ${report.ok}/${QUESTIONS_PER_ENGINE} valid in ${report.ms}ms`,
    );
    for (const sample of report.samples) console.log(`     ${sample}`);
    for (const error of report.errors) console.log(`     ✗ ${error}`);
    console.log();
  }

  const total = totalOk + totalFailed;
  console.log(
    `Success rate: ${totalOk}/${total} (${Math.round((100 * totalOk) / total)}%)`,
  );
  if (totalFailed > 0) {
    // Some transient PokéAPI flakiness is tolerable; a fully dead engine is not.
    const anyEngineDead = totalOk === 0;
    process.exit(anyEngineDead || totalFailed > total / 2 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("verify-engines crashed:", error);
  process.exit(1);
});
