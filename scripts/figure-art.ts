/**
 * The cut-out figures' pictures (the race, The History of the Pokémon World,
 * The Story of Pokémon) as static files the CDN serves straight away, so no
 * request ever waits on a function transcoding a picture (or sends its bytes
 * through one): public/race/art/<256|512>/<id>.webp, every figure's Pokémon
 * HOME render with its edge colours bled outwards (src/lib/server/figure-art).
 *
 *   NODE_OPTIONS=--conditions=react-server NODE_USE_ENV_PROXY=1 npx tsx scripts/figure-art.ts          (missing ones only)
 *   NODE_OPTIONS=--conditions=react-server NODE_USE_ENV_PROXY=1 npx tsx scripts/figure-art.ts --force  (every one again)
 *
 * Re-run after the race or the films add a figure (tests/figure-art.test.ts
 * names any that are missing).
 */
import fs from "node:fs";
import path from "node:path";
import { homeRenderUrl } from "../src/lib/pokemon/art";
import { FIGURE_ART_SIZES, transcodeFigure } from "../src/lib/server/figure-art";
import { figureArtIds } from "../src/lib/server/figure-art-ids";

const OUT = path.join(process.cwd(), "public/race/art");
const force = process.argv.includes("--force");

async function fetchPng(id: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(homeRenderUrl(id)).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || res?.status === 404) throw new Error(`HOME render ${id}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main() {
  for (const size of FIGURE_ART_SIZES) fs.mkdirSync(path.join(OUT, String(size)), { recursive: true });
  const file = (id: number, size: number) => path.join(OUT, String(size), `${id}.webp`);
  const ids = figureArtIds();
  const todo = ids.filter((id) => force || FIGURE_ART_SIZES.some((s) => !fs.existsSync(file(id, s))));
  let bytes = 0;
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (id) => {
        const png = await fetchPng(id);
        for (const size of FIGURE_ART_SIZES) {
          const webp = await transcodeFigure(png, size);
          fs.writeFileSync(file(id, size), webp);
          bytes += webp.length;
        }
      })
    );
    process.stdout.write(`\rfigures ${Math.min(i + 8, todo.length)}/${todo.length}`);
  }
  console.log(`\n${todo.length} figures written (${Math.round(bytes / 1024)} KB); ${ids.length} in all.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
