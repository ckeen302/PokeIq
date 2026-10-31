/**
 * Carries the 3D remakes' accepted matches (scripts/geo/spots3d.ts) onto our
 * world map through the per-area alignment gate (scripts/geo/spot-align.ts,
 * loaded at run time), runs the known-answer test, and writes
 * src/data/geo-shot-spots-3d.json: { id: [x, y, confidence, method, scored] }.
 *
 *   npx tsx scripts/geo/spots3d-world.ts <cache-dir> <known-answers.json> [family…]
 *
 * The rules are the 2D spots' (scripts/geo/spots-2d.ts): a spot is kept only
 * when its area's fit passes the gate; towns keep theirs unscored; a route is
 * scored only when it's drawn long enough and a screen of it is a small part
 * of it; a method whose known answers miss is dropped entirely.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import geo from "../../src/data/geo.json";
import { ripPath } from "./spots3d-rips";
import type { Match } from "./spots3d";

type Px = [number, number];
interface AreaFit {
  ok: boolean;
  reasons: string[];
  toWorld: (x: number, y: number) => Px;
}
interface AreaGeometry {
  pathBox: [number, number, number, number] | null;
  pathNote?: string;
}
/** What this script uses of the alignment gate. */
interface AlignApi {
  loadAtlas(root?: string): Promise<{ width: number; height: number }>;
  areaGeometry(atlas: unknown, region: string, name: string): AreaGeometry | null;
  shapeOf(rgba: Buffer, width: number, height: number, cell?: number): unknown;
  fitArea(atlas: unknown, area: AreaGeometry, shape: unknown): AreaFit;
  normalised(atlas: { width: number; height: number }, p: Px): [number, number];
}

export type SpotRow = [x: number, y: number, confidence: number, method: string, scored: boolean];

/** The method each family's spots come from. */
const METHOD: Record<string, string> = { bdsp: "flat3d" };
/** As spots-2d.ts: a town is one block on our map. */
const TOWN = /\b(City|Town|Village|Island|Plateau)$/;
/** A route drawn shorter than this (world px) can't place a spot. */
const MIN_ROUTE_PX = 30;
/** A screen may cover at most this share of a route along its length. */
const MAX_FOOTPRINT = 0.4;
/** What a 3D screen shows of the ground, in tiles (across, down). */
const VIEW_TILES: Px = [24, 14];
/** Known-answer test: every accepted known answer within this many world px (the 2D methods' tolerance; KNOWN_TOL_PX overrides it for a what-if run). */
const KNOWN_TOL_PX = Number(process.env.KNOWN_TOL_PX ?? 2);

const OUT = process.env.SPOTS_OUT ?? path.join(process.cwd(), "src/data/geo-shot-spots-3d.json");
const regionOf = new Map((geo as unknown as { world: { locations: { name: string; region: string }[] } }).world.locations.map((l) => [l.name, l.region]));

async function main() {
  const [dir, knownFile, ...fams] = process.argv.slice(2);
  const families = fams.length ? fams : Object.keys(METHOD);
  const A = (await import(process.env.SPOT_ALIGN ?? "./spot-align")) as AlignApi;
  const atlas = await A.loadAtlas(process.cwd());
  const fits = new Map<string, { fit: AreaFit | null; area: AreaGeometry | null }>();
  const fitOf = async (loc: string, rip: string) => {
    const k = `${loc}|${rip}`;
    if (!fits.has(k)) {
      const region = regionOf.get(loc) ?? "";
      const area = A.areaGeometry(atlas, region, loc);
      const { data, info } = await sharp(ripPath(dir, rip)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      fits.set(k, { area, fit: area ? A.fitArea(atlas, area, A.shapeOf(data, info.width, info.height, 16)) : null });
    }
    return fits.get(k)!;
  };

  const known = JSON.parse(readFileSync(knownFile, "utf8")) as Record<string, { rip: string; at: Px; calibration?: boolean }>;
  const spots: Record<string, SpotRow> = {};
  const report: Record<string, unknown> = {};
  for (const family of families) {
    const matches = JSON.parse(readFileSync(path.join(dir, `matches-${family}.json`), "utf8")) as Match[];

    // Known-answer test, on the accepted matches (the calibration shot aside): error in tiles and in world px.
    const kat: { id: string; tiles: number; worldPx: number | null }[] = [];
    for (const m of matches) {
      const k = known[m.id];
      if (!k || k.calibration || !m.ok || k.rip !== m.rip) continue;
      const tiles = Math.hypot(m.at[0] - k.at[0], m.at[1] - k.at[1]) / 16;
      const { fit } = await fitOf(m.loc, m.rip);
      let worldPx: number | null = null;
      if (fit) {
        const a = fit.toWorld(...m.at);
        const b = fit.toWorld(...k.at);
        worldPx = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 10) / 10;
      }
      kat.push({ id: m.id, tiles: Math.round(tiles * 100) / 100, worldPx });
    }
    const pass = kat.length > 0 && kat.every((r) => r.worldPx === null || r.worldPx <= KNOWN_TOL_PX);

    let spotted = 0;
    let scored = 0;
    const why: Record<string, number> = {};
    for (const m of matches.filter((x) => x.ok)) {
      const { fit, area } = await fitOf(m.loc, m.rip);
      if (!fit || !fit.ok) {
        const r = fit ? `alignment: ${fit.reasons[0]}` : "place not on the atlas";
        why[r] = (why[r] ?? 0) + 1;
        continue;
      }
      const [x, y] = A.normalised(atlas, fit.toWorld(...m.at));
      const reasons: string[] = [];
      if (TOWN.test(m.loc)) reasons.push("town");
      else if (!area?.pathBox) reasons.push(area?.pathNote ?? "no drawn path");
      else {
        const [x0, y0, x1, y1] = area.pathBox;
        const tall = y1 - y0 >= x1 - x0;
        if ((tall ? y1 - y0 : x1 - x0) < MIN_ROUTE_PX) reasons.push("route drawn too short");
        const along = tall ? (VIEW_TILES[1] * 16) / m.ripSize[1] : (VIEW_TILES[0] * 16) / m.ripSize[0];
        if (along > MAX_FOOTPRINT) reasons.push("a screen covers too much of the route");
      }
      // Counted either way (so the report says what the method would add); written only when it passed.
      spotted++;
      if (!reasons.length) scored++;
      else for (const r of reasons) why[r] = (why[r] ?? 0) + 1;
      if (pass) spots[m.id] = [x, y, m.confidence, METHOD[family], reasons.length === 0];
    }
    const areaFits = [...fits.entries()].filter(([k]) => matches.some((m) => k === `${m.loc}|${m.rip}`) && !TOWN.test(k.split("|")[0]));
    report[family] = {
      method: METHOD[family],
      matched: matches.filter((m) => m.rip).length,
      accepted: matches.filter((m) => m.ok).length,
      [pass ? "spotted" : "wouldSpot"]: spotted,
      [pass ? "scored" : "wouldScore"]: scored,
      knownAnswers: { pass, tolerancePx: KNOWN_TOL_PX, n: kat.length, results: kat },
      areaFitsPassed: `${areaFits.filter(([, f]) => f.fit?.ok).length}/${areaFits.length}`,
      notSpottedOrUnscored: why,
    };
  }
  const sorted = Object.fromEntries(Object.entries(spots).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(OUT, `${JSON.stringify(sorted)}\n`);
  writeFileSync(path.join(dir, "world-report.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
