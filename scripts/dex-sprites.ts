/**
 * The sprites manifest for the Pokédex entry's sprites table: for every
 * species, which of each generation's sprites (normal, shiny) exist in
 * PokéAPI's sprite repository, so pages link only files that are there.
 *
 *   npm run dex:sprites [-- path to a PokeAPI/sprites checkout]
 *
 * With no path it makes a shallow, blobless clone (file names only, no
 * pictures: a few MB) in the temp folder and lists its tree once.
 *
 * Output: src/data/dex-sprites.json — { source, rows }, rows[id - 1] one
 * character per generation (see SpriteCode in src/lib/pokemon/sprites.ts).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { LAST_SPRITE_GEN, NORMAL_BIT, SHINY_BIT, SPRITE_SOURCES, spritePath } from "../src/lib/pokemon/sprites";

const OUT = path.join(process.cwd(), "src/data/dex-sprites.json");
const DEX = path.join(process.cwd(), "src/data/pokedex.json");
const REPO = "https://github.com/PokeAPI/sprites";

function checkout(): { dir: string; temp: boolean } {
  const given = process.argv[2];
  if (given) return { dir: path.resolve(given), temp: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokeapi-sprites-"));
  console.log(`Cloning ${REPO} (names only) into ${dir}`);
  execFileSync("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, dir], { stdio: "inherit" });
  return { dir, temp: true };
}

const { dir, temp } = checkout();
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha = git("rev-parse", "HEAD").trim();
const files = new Set(
  git("ls-tree", "-r", "--name-only", "HEAD", "sprites/pokemon/versions", "sprites/pokemon/other/home")
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^sprites\/pokemon\//, ""))
);
if (temp) fs.rmSync(dir, { recursive: true, force: true });
if (files.size < 1000) throw new Error(`Only ${files.size} sprite files listed: is ${dir} a PokeAPI/sprites checkout?`);

const dex = JSON.parse(fs.readFileSync(DEX, "utf8")) as { id: number; gen: number }[];
const rows: string[] = [];
const missing: Record<number, { normal: number; shiny: number }> = {};
for (const p of [...dex].sort((a, b) => a.id - b.id)) {
  if (p.id !== rows.length + 1) throw new Error(`Pokédex numbers skip at #${p.id}`);
  let row = "";
  for (let g = 1; g <= LAST_SPRITE_GEN; g++) {
    if (g < p.gen) {
      row += "-";
      continue;
    }
    const src = SPRITE_SOURCES.find((s) => s.gen === g)!;
    const has = (shiny: boolean) => {
      const f = spritePath(src, p.id, shiny);
      return f !== null && files.has(f);
    };
    const bits = (has(false) ? NORMAL_BIT : 0) | (has(true) ? SHINY_BIT : 0);
    missing[g] ??= { normal: 0, shiny: 0 };
    if (!(bits & NORMAL_BIT)) missing[g].normal++;
    if (src.shiny && !(bits & SHINY_BIT)) missing[g].shiny++;
    row += String(bits);
  }
  rows.push(row);
}

fs.writeFileSync(OUT, JSON.stringify({ source: `PokeAPI/sprites@${sha}`, rows }) + "\n");
console.log(`Wrote ${rows.length} species to ${path.relative(process.cwd(), OUT)} (PokeAPI/sprites ${sha.slice(0, 10)})`);
for (const [g, m] of Object.entries(missing)) if (m.normal || m.shiny) console.log(`  Gen ${g}: ${m.normal} without a sprite, ${m.shiny} without a shiny`);
