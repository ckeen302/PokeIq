/**
 * One p75 table from result files of measure.mjs (shards of one sweep, or several runs).
 *   node scripts/perf-sweep/summary.mjs results/a.json results/b.json
 *   node scripts/perf-sweep/summary.mjs --compare before.json after.json    # before → after, side by side
 */
import fs from "fs";
import { summary } from "./measure.mjs";

const args = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, "utf8")).results;
if (args[0] === "--compare") {
  const [a, b] = [load(args[1]), load(args[2])];
  const p75 = (xs) => {
    const v = xs.filter((x) => x != null).sort((m, n) => m - n);
    return v.length ? v[Math.min(v.length - 1, Math.ceil(0.75 * v.length) - 1)] : null;
  };
  const cols = [
    ["LCP", "lcp", 0],
    ["CLS", "cls", 3],
    ["TBT", "tbt", 0],
    ["LT>load", "longestAfterLoad", 0],
    ["INP", "inp", 0],
    ["JS KB", "jsBeforeLoadKB", 0],
    ["after-load KB", "afterKB", 0],
  ];
  for (const r of [...a, ...b]) r.afterKB = (r.jsAfterLoadKB ?? 0) + (r.prefetchKB ?? 0);
  const labels = [...new Set(b.map((r) => r.label))];
  console.log(`| route | ${cols.map((c) => c[0]).join(" | ")} |\n| --- |${" --- |".repeat(cols.length)}`);
  for (const l of labels) {
    const f = (rs, k, d) => {
      const v = p75(rs.filter((r) => r.label === l).map((r) => r[k]));
      return v == null ? "-" : v.toFixed(d);
    };
    console.log(`| ${l} | ${cols.map(([, k, d]) => `${f(a, k, d)} → ${f(b, k, d)}`).join(" | ")} |`);
  }
} else console.log(summary(args.flatMap(load)));
