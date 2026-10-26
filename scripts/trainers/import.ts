/**
 * Build src/data/trainers/<game>.json from the pret decompilation projects.
 *
 *   # shallow clones (delete them afterwards — only the JSON is committed)
 *   git clone --depth 1 https://github.com/pret/pokered      $PRET/pokered
 *   git clone --depth 1 https://github.com/pret/pokeyellow   $PRET/pokeyellow
 *   git clone --depth 1 https://github.com/pret/pokegold     $PRET/pokegold
 *   git clone --depth 1 https://github.com/pret/pokecrystal  $PRET/pokecrystal
 *   git clone --depth 1 https://github.com/pret/pokeruby     $PRET/pokeruby
 *   git clone --depth 1 https://github.com/pret/pokeemerald  $PRET/pokeemerald
 *   git clone --depth 1 https://github.com/pret/pokefirered  $PRET/pokefirered
 *   git clone --depth 1 https://github.com/pret/pokediamond  $PRET/pokediamond
 *   git clone --depth 1 https://github.com/pret/pokeplatinum $PRET/pokeplatinum
 *   git clone --depth 1 https://github.com/pret/pokeheartgold $PRET/pokeheartgold
 *   PRET=$PRET npx tsx scripts/trainers/import.ts [game…]
 *
 * Every species, move and item is resolved against our Pokédex data; anything
 * unknown aborts the import rather than being guessed.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TRAINER_GAMES } from "../../src/lib/trainers/games";
import { notableFor } from "../../src/lib/trainers/notable";
import { assemble, type RawTeam } from "./model";
import { importGen1 } from "./gen1";
import { importGen2 } from "./gen2";
import { importGen3 } from "./gen3";
import { importPlatinum } from "./platinum";
import { importDiamondPearl } from "./diamond-pearl";
import { importHgss } from "./hgss";

const PRET = process.env.PRET ?? "/home/user/pret";
const OUT = path.join(process.cwd(), "src/data/trainers");
fs.mkdirSync(OUT, { recursive: true });

const want = process.argv.slice(2);
for (const g of TRAINER_GAMES) {
  if (want.length && !want.includes(g.key)) continue;
  const repoDir = path.join(PRET, g.repo.split("/")[1]);
  const commit = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  let raw: RawTeam[];
  switch (g.key) {
    case "red-blue":
    case "yellow":
      raw = importGen1(repoDir, g.key).teams;
      break;
    case "gold-silver":
    case "crystal":
      raw = importGen2(repoDir, g.key);
      break;
    case "ruby-sapphire":
    case "emerald":
    case "firered-leafgreen":
      raw = importGen3(repoDir, g.key);
      break;
    case "diamond-pearl":
      raw = importDiamondPearl(repoDir);
      break;
    case "platinum":
      raw = importPlatinum(repoDir);
      break;
    case "heartgold-soulsilver":
      raw = importHgss(repoDir);
      break;
    default:
      continue;
  }
  const file = assemble(g.key, { repo: g.repo, commit }, raw, (t) => notableFor(g.key, t.clsConst, t.name, t.cls));
  const json = JSON.stringify(file);
  fs.writeFileSync(path.join(OUT, `${g.key}.json`), json + "\n");
  const unplaced = file.teams.filter((t) => !t.at.length).length;
  console.log(`${g.key}: ${file.teams.length} teams, ${file.areas.length} areas, ${unplaced} unplaced, ${(json.length / 1024).toFixed(0)} KB`);
}
