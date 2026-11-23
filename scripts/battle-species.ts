/**
 * The battle pages' species index: every species and forme name Showdown knows with the id
 * and National Dex number its sprite needs, so a page that only shows sprites (a team list, the Battle Factory and
 * Tower) doesn't download and run all of @pkmn/dex (1.8 MB) to find them.
 *
 *   npm run battle:species    (re-run after bumping @pkmn/dex; tests/battle-species.test.ts fails until then)
 *
 * Output: src/data/battle-species.json — { [id]: dexNumber }.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSpeciesIndex } from "../src/lib/battle/species-index-build";

const OUT = path.join(process.cwd(), "src/data/battle-species.json");
const index = buildSpeciesIndex();
fs.writeFileSync(OUT, `${JSON.stringify(index)}\n`);
console.log(`wrote ${OUT}: ${Object.keys(index).length} species and formes`);
