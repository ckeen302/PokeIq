/**
 * Audits every PokéGuessr screenshot without changing any of them: it reads
 * each published shot from storage, measures it, and writes what it found to
 * src/data/geo-shot-meta.json. Nothing is removed or replaced; the game uses
 * the flags only to deal low-quality shots less often, and the difficulty to
 * offer Easy / Hard games and to ramp the Daily.
 *
 *   npx tsx scripts/geo/audit-shots.ts            # every shot not audited yet
 *   npx tsx scripts/geo/audit-shots.ts --all      # re-measure every shot
 *
 * Per shot: [width, height, flags, difficulty × 10]. Flags (bits):
 *   1 small  · the picture is under 480 × 270
 *   2 blurry · a 3D capture with little fine detail (soft or upscaled)
 *   4 ui     · one flat colour covers most of the frame (menus, text boxes, fades)
 *   8 tall   · taller than wide by a third or more (a map strip, not a view)
 * Difficulty (1–5) is a heuristic from the place and the picture; the server
 * replaces it with players' real average scores once enough rounds are logged
 * (geo_round_scores, migration 0038).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { familyEra, familyOfGame, isGeoFamily, type GeoFamilyId } from "../../src/lib/geo-families";
import { SHOT_FLAG, heuristicDifficulty, type ShotMetaFile } from "../../src/lib/geo-difficulty";

const DATA = path.join(process.cwd(), "src/data/geo.json");
const OUT = path.join(process.cwd(), "src/data/geo-shot-meta.json");
const CONCURRENCY = 8;

interface StoredShot {
  id: string;
  game: string;
  family?: string;
}
interface StoredLocation {
  name: string;
  region?: string;
  parent?: string;
  shots: StoredShot[];
}

async function measure(buf: Buffer, era: "2d" | "3d") {
  const img = sharp(buf);
  const { width = 0, height = 0 } = await img.metadata();
  // Detail: the spread of a Laplacian over a 512-px-wide greyscale copy.
  const small = sharp(buf).greyscale().resize({ width: Math.min(512, width) });
  const lap = await small
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  const detail = Math.sqrt(Math.max(0, sq / lap.length - mean * mean));
  // Flatness: the share of the frame in its single most common (quantised) colour.
  const rgb = await sharp(buf).removeAlpha().resize({ width: 160 }).raw().toBuffer();
  const counts = new Map<number, number>();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = Math.max(...counts.values()) / (rgb.length / 3);
  let flags = 0;
  if (width < 480 || height < 270) flags |= SHOT_FLAG.small;
  if (era === "3d" && detail < 6) flags |= SHOT_FLAG.blurry;
  if (top > 0.5) flags |= SHOT_FLAG.ui;
  if (height > width * 1.33) flags |= SHOT_FLAG.tall;
  return { width, height, flags, detail, top };
}

async function main() {
  const all = process.argv.includes("--all");
  const geo = JSON.parse(readFileSync(DATA, "utf8")) as { storageBase: string; world: { locations: StoredLocation[] } };
  const prev: ShotMetaFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { v: 1, shots: {} };
  const shotsPerPlace = new Map<string, number>();
  for (const l of geo.world.locations) {
    const key = `${l.region}|${l.parent ?? l.name}`;
    shotsPerPlace.set(key, (shotsPerPlace.get(key) ?? 0) + l.shots.length);
  }
  const jobs = geo.world.locations.flatMap((l) => l.shots.map((s) => ({ l, s })));
  const todo = jobs.filter(({ s }) => all || !prev.shots[s.id]);
  console.log(`${jobs.length} shots, ${todo.length} to audit`);
  let done = 0;
  let failed = 0;
  const queue = [...todo];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { l, s } = job;
      const family = (isGeoFamily(s.family) ? s.family : familyOfGame(s.game)) as GeoFamilyId | null;
      if (!family) continue;
      try {
        const res = await fetch(`${geo.storageBase}/${s.id}.webp`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = await measure(Buffer.from(await res.arrayBuffer()), familyEra(family));
        const d = heuristicDifficulty({
          name: l.name,
          parent: l.parent,
          family,
          flags: m.flags,
          detail: m.detail,
          placeShots: shotsPerPlace.get(`${l.region}|${l.parent ?? l.name}`) ?? 1,
        });
        prev.shots[s.id] = [m.width, m.height, m.flags, Math.round(d * 10)];
      } catch (err) {
        failed++;
        console.log(`  ! ${s.id}: ${(err as Error).message}`);
      }
      if (++done % 100 === 0) {
        console.log(`  ${done}/${todo.length}`);
        writeFileSync(OUT, JSON.stringify(prev));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(OUT, JSON.stringify(prev));
  const rows = Object.values(prev.shots);
  const count = (bit: number) => rows.filter((r) => r[2] & bit).length;
  const bands = [1, 2, 3, 4, 5].map((b) => rows.filter((r) => Math.round(r[3] / 10) === b).length);
  console.log(`audited ${rows.length} (${failed} failed this run)`);
  console.log(`flags: small ${count(SHOT_FLAG.small)}, blurry ${count(SHOT_FLAG.blurry)}, ui ${count(SHOT_FLAG.ui)}, tall ${count(SHOT_FLAG.tall)}, any ${rows.filter((r) => r[2]).length}`);
  console.log(`difficulty 1–5: ${bands.join(" / ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
