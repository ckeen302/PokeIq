/**
 * The Pikadoku category list the browser may know: ids, labels and families,
 * never members. Unlimited's setup panel lists these, and a board's ticked
 * categories travel packed against this order (lib/pikadoku/catalog).
 *
 *   npx tsx scripts/pikadoku-catalog.ts     # writes src/data/pikadoku-catalog.json
 *
 * tests/pikadoku-unlimited.test.ts fails when the file and the categories drift apart.
 */
import fs from "node:fs";
import path from "node:path";
import { catalogRows } from "@/lib/pikadoku/catalog-source";

const OUT = path.join(process.cwd(), "src/data/pikadoku-catalog.json");
fs.writeFileSync(OUT, `[\n${catalogRows().map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`wrote ${OUT}`);
