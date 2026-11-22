/**
 * Downloads the sprites the Shiny Pokémon Maker's data is built from into .cache/shiny-maker (git-ignored):
 *   bw/{id}.png, bw-shiny/{id}.png        Black/White-style 96 px sprites (PokeAPI; fan-made B/W style for #650+ by the Smogon Sprite Project)
 *   home-shiny/{id}.png                    Pokémon HOME shiny renders (PokeAPI), paired with public/sizes/art/512/{id}.webp for HD masks
 *   art/{id}.png, art-shiny/{id}.png       official artwork, normal and shiny (PokeAPI)          (--art)
 *   anim.json                              which species have an animated B/W sprite
 *   npx tsx scripts/shiny-maker/fetch.ts [--home] [--art]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const BW = `${RAW}/versions/generation-v/black-white`;
const OUT = ".cache/shiny-maker";
const LAST = 1025;

async function get(url: string, tries = 4): Promise<Buffer | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function main() {
  const home = process.argv.includes("--home");
  const art = process.argv.includes("--art");
  for (const d of ["bw", "bw-shiny", "home-shiny", "art", "art-shiny"]) mkdirSync(join(OUT, d), { recursive: true });
  const ids = Array.from({ length: LAST }, (_, i) => i + 1);
  const anim: number[] = [];
  let done = 0;
  await pool(ids, 16, async (id) => {
    const jobs: [string, string][] = [
      [`${BW}/${id}.png`, join(OUT, "bw", `${id}.png`)],
      [`${BW}/shiny/${id}.png`, join(OUT, "bw-shiny", `${id}.png`)],
    ];
    if (home) jobs.push([`${RAW}/other/home/shiny/${id}.png`, join(OUT, "home-shiny", `${id}.png`)]);
    if (art) jobs.push([`${RAW}/other/official-artwork/${id}.png`, join(OUT, "art", `${id}.png`)], [`${RAW}/other/official-artwork/shiny/${id}.png`, join(OUT, "art-shiny", `${id}.png`)]);
    for (const [url, file] of jobs) {
      if (existsSync(file)) continue;
      const buf = await get(url);
      if (buf) writeFileSync(file, buf);
      else console.warn(`missing ${url}`);
    }
    const r = await fetch(`${BW}/animated/${id}.gif`, { method: "HEAD" }).catch(() => null);
    if (r?.ok) anim.push(id);
    if (++done % 100 === 0) console.log(done);
  });
  writeFileSync(join(OUT, "anim.json"), JSON.stringify(anim.sort((a, b) => a - b)));
  console.log(`done; animated: ${anim.length}`);
}

main();
