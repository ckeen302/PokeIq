/**
 * Re-run the atlas matcher over the built encounter files (no network):
 *
 *   npx tsx scripts/dex/relink-encounters.ts
 *
 * Rows that have no atlas link yet get one when their place label matches
 * exactly one atlas place in the games' regions after format-only
 * normalisation (see normPlace / atlasQuery). Existing links are kept.
 */
import fs from "node:fs";
import path from "node:path";
import geo from "../../src/data/geo.json";
import { atlasQuery, buildAtlasIndex } from "../../src/lib/pokemon/encounter-transform";
import type { EncGen, EncRow } from "../../src/lib/pokemon/encounter-types";

const atlas = buildAtlasIndex((geo as { world: { locations: { name: string; region: string }[] } }).world.locations);
const dir = path.join(process.cwd(), "src/data/encounters");
let added = 0;
let files = 0;
const names = new Set<string>();
for (const f of fs.readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) {
  const file = path.join(dir, f);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { gens: EncGen[] };
  let changed = false;
  for (const g of data.gens) {
    g.rows = g.rows.map((r): EncRow => {
      if (r.a || r.x || !r.loc) return r;
      const a = atlasQuery(r.loc, r.v, atlas);
      if (!a) return r;
      added++;
      names.add(`${r.loc} -> ${a}`);
      changed = true;
      const { v, loc, ...rest } = r;
      return { v, loc, a, ...rest };
    });
  }
  if (changed) {
    files++;
    fs.writeFileSync(file, JSON.stringify(data));
  }
}
console.log(`linked ${added} rows in ${files} files; ${names.size} label->place pairs:`);
for (const n of [...names].sort()) console.log(`  ${n}`);
