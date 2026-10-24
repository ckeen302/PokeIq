/**
 * Pre-generates the "Which is the real shiny?" images, three difficulties per
 * Pokémon, each set with its own copy of the real shiny. Every file is encoded
 * identically and named with 16 random bytes, so nothing about a URL says which
 * is real. Writes the answer map to src/data/shiny/answers.json (server-only).
 * Resumable: Pokémon already in the map are skipped.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/shiny/generate.ts <spriteCacheDir> <webpOutDir>
 *
 * Sprites come from PokeAPI's shiny/{id}.png, falling back to the HOME shiny
 * render; the run fails if any of the 1,025 can't be had.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { SHINY_DIFFICULTIES, encodeOption, loadRaw, makeDecoys, meanDeltaE, PROFILES } from "./decoys";

const TOTAL = 1025;
const ANSWERS = path.join(process.cwd(), "src/data/shiny/answers.json");
const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";

async function sprite(cache: string, id: number): Promise<Buffer> {
  const file = path.join(cache, `${id}.png`);
  if (existsSync(file)) return readFile(file);
  for (const dir of ["shiny/", "other/home/shiny/"]) {
    const res = await fetch(`${BASE}${dir}${id}.png`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    }
  }
  throw new Error(`no shiny sprite for #${id}`);
}

async function main() {
  const [cache, out] = process.argv.slice(2);
  if (!cache || !out) throw new Error("usage: generate.ts <spriteCacheDir> <webpOutDir>");
  await mkdir(cache, { recursive: true });
  await mkdir(out, { recursive: true });
  await mkdir(path.dirname(ANSWERS), { recursive: true });
  const sets: Record<string, string[][]> = existsSync(ANSWERS) ? JSON.parse(await readFile(ANSWERS, "utf8")).sets : {};
  const worst: Record<string, number> = {};
  const used = new Set(Object.values(sets).flat(2));
  const fresh = () => {
    for (;;) {
      const id = randomBytes(16).toString("hex");
      if (!used.has(id)) return used.add(id), id;
    }
  };
  for (let id = 1; id <= TOTAL; id++) {
    if (sets[id]) continue;
    const real = await loadRaw(await sprite(cache, id));
    const rows: string[][] = [];
    for (const difficulty of SHINY_DIFFICULTIES) {
      let decoys;
      try { decoys = makeDecoys(real, id * 7919 + SHINY_DIFFICULTIES.indexOf(difficulty), difficulty); } catch (e) { throw new Error(`#${id} ${difficulty}: ${(e as Error).message}`); }
      const raws = [real, ...decoys.map((d) => d.raw)];
      for (const d of decoys) worst[difficulty] = Math.min(worst[difficulty] ?? Infinity, meanDeltaE(real, d.raw));
      const names = raws.map(fresh);
      await Promise.all(raws.map(async (raw, i) => writeFile(path.join(out, `${names[i]}.webp`), await encodeOption(raw))));
      rows.push(names); // [real, decoy, decoy, decoy]
    }
    sets[id] = rows;
    if (id % 50 === 0 || id === TOTAL) {
      await writeFile(ANSWERS, JSON.stringify({ difficulties: SHINY_DIFFICULTIES, sets }));
      console.log(`#${id}`, Object.entries(worst).map(([k, v]) => `${k} min ΔE ${v.toFixed(1)} (floor ${PROFILES[k as "easy"].min})`).join(" | "));
    }
  }
  if (Object.keys(sets).length !== TOTAL) throw new Error("incomplete");
  await writeFile(ANSWERS, JSON.stringify({ difficulties: SHINY_DIFFICULTIES, sets }));
  console.log("done", TOTAL, "Pokémon,", TOTAL * 12, "images");
}
main().catch((e) => { console.error(e); process.exit(1); });
