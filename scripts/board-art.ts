/**
 * Every species' official artwork at 160px, as static files the CDN serves
 * straight away: public/art/160/<id>.webp. PokéConnections' boards (the
 * daily, Unlimited, duels, parties) show sixteen of these at once, and a
 * static file never waits on /api/art waking up and transcoding on a cold
 * edge. Same picture as /api/art/<id>?s=160 (src/lib/server/art-transcode).
 *
 *   npx tsx scripts/board-art.ts            (only the missing files)
 *   npx tsx scripts/board-art.ts --force    (all of them again)
 *
 * Re-run when the Pokédex grows (src/data/pokedex.json).
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "@/data/pokedex.json";
import { BOARD_ART_SIZE } from "@/lib/pokemon/art";
import { officialArtworkUrl, transcodeArt } from "@/lib/server/art-transcode";

const OUT = path.join(process.cwd(), "public/art", String(BOARD_ART_SIZE));
const force = process.argv.includes("--force");

async function fetchPng(id: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(officialArtworkUrl(id)).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || res?.status === 404) throw new Error(`artwork ${id}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ids = (pokedex as { id: number }[]).map((p) => p.id).sort((a, b) => a - b);
  const todo = ids.filter((id) => force || !fs.existsSync(path.join(OUT, `${id}.webp`)));
  let bytes = 0;
  for (let i = 0; i < todo.length; i += 16) {
    await Promise.all(
      todo.slice(i, i + 16).map(async (id) => {
        const webp = await transcodeArt(await fetchPng(id), BOARD_ART_SIZE);
        fs.writeFileSync(path.join(OUT, `${id}.webp`), webp);
        bytes += webp.length;
      })
    );
    process.stdout.write(`\r${Math.min(i + 16, todo.length)}/${todo.length}`);
  }
  console.log(`\n${todo.length} written (${Math.round(bytes / 1024)} KB) to ${path.relative(process.cwd(), OUT)}; ${ids.length} species in all.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
