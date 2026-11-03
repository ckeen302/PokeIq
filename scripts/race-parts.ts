/**
 * Audit of the race runners' moving parts (src/lib/race/parts.ts): runs
 * the part finder over every runner's relief map, as the race does while
 * it loads, and reports what it found by gait, and which runners whose
 * gait uses legs got none (they keep whole-body motion).
 *
 *   npx tsx --conditions=react-server scripts/race-parts.ts [--only=pikachu,zeraora] [--top] [--png=out.png] [--list]
 *
 * --top audits the popular set: every preset's field (at each distance),
 * every starter's line, Eevee's, the pseudo-legendaries', the legendaries
 * and mythicals, and the top 25 of every Smogon usage list in
 * src/data/smogon. Coverage there counts runners with moving legs, arms or
 * wings (balls, serpents and swimmers move their whole body by design).
 *
 * --png draws a contact sheet of the parts (legs red, arms blue, wings
 * yellow, tails violet; joints green), for tuning.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { RACE_ENTRANTS, RACE_POKEMON } from "../src/lib/race/data";
import { EEVEE, PRESETS, PSEUDO_LEGENDARIES, STARTER_BASES } from "../src/lib/race/presets";
import { describeParts, findParts, type PartMap } from "../src/lib/race/parts";
import type { Entrant } from "../src/lib/race/types";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("only")?.split(",");
const png = arg("png");
const COL: Record<string, [number, number, number]> = { leg: [255, 80, 60], arm: [80, 200, 255], wing: [240, 220, 60], tail: [190, 90, 255] };

async function partsOf(e: Entrant) {
  const file = join("public", e.depth === "sizes" ? "sizes/depth" : "race/depth", `${e.art}.webp`);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const map = { w: info.width, h: info.height, data, channels: info.channels as 3 | 4 };
  return { map, pm: findParts(map, { motion: e.motion, shape: e.shape }) };
}

async function tile(e: Entrant, map: { w: number; h: number; data: Buffer; channels: number }, pm: PartMap) {
  const img = Buffer.alloc(128 * 128 * 3, 20);
  for (let y = 0; y < pm.h; y++) for (let x = 0; x < pm.w; x++) {
    const i = y * pm.w + x, o = (y * 128 + x) * 3;
    if (!map.data[i * map.channels + 2]) continue;
    const g = Math.max(40, Math.min(200, (map.data[i * map.channels] - 100) * 2.5));
    if (pm.label[i]) {
      const c = COL[pm.parts[pm.label[i] - 1].kind], k = (0.35 + 0.65 * pm.weight[i]) * (pm.parts[pm.label[i] - 1].side ? 0.6 : 1);
      img[o] = c[0] * k; img[o + 1] = c[1] * k; img[o + 2] = c[2] * k;
    } else img[o] = img[o + 1] = img[o + 2] = g;
  }
  for (const p of pm.parts) for (const [x, y] of [[p.px, p.py], [p.tx, p.ty]]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = Math.round(x) + dx, Y = Math.round(y) + dy;
      if (X >= 0 && Y >= 0 && X < 128 && Y < 128) { const o = (Y * 128 + X) * 3; img[o] = 0; img[o + 1] = 255; img[o + 2] = 0; }
    }
  }
  const pic = await sharp(img, { raw: { width: 128, height: 128, channels: 3 } }).resize(256, 256, { kernel: "nearest" }).png().toBuffer();
  const label = `${e.name} · ${e.motion} · ${describeParts(pm)}`.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = Buffer.from(`<svg width="256" height="18"><rect width="100%" height="100%" fill="#000"/><text x="2" y="13" font-size="11" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
  return { pic, svg };
}

/** The popular set (see --top). */
function popular(): Entrant[] {
  const keys = new Set<string>();
  for (const p of PRESETS) {
    if (p.id === "every-pokemon" || !p.pick) continue;
    for (const d of [100, 200, 400] as const) for (const e of p.pick(RACE_ENTRANTS, d)) keys.add(e.key);
  }
  const chainOf = (ids: readonly number[]) => new Set(RACE_POKEMON.filter((e) => ids.includes(e.species)).map((e) => e.chain));
  const chains = new Set([...chainOf(STARTER_BASES), ...chainOf([EEVEE]), ...chainOf(PSEUDO_LEGENDARIES)]);
  for (const e of RACE_POKEMON) if (chains.has(e.chain) || e.legendary || e.mythical) keys.add(e.key);
  const slug = (name: string) => name.toLowerCase().replace(/[’'.:]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const f of readdirSync("src/data/smogon")) {
    const data = JSON.parse(readFileSync(join("src/data/smogon", f), "utf8")) as { pokemon: { species: string; usage: number }[] };
    for (const row of [...data.pokemon].sort((a, b) => b.usage - a.usage).slice(0, 25)) {
      const k = slug(row.species);
      const hit = RACE_ENTRANTS.find((e) => e.key === k) ?? RACE_ENTRANTS.find((e) => e.key === k.split("-")[0]);
      if (hit) keys.add(hit.key);
    }
  }
  keys.add("pikachu");
  return RACE_ENTRANTS.filter((e) => keys.has(e.key));
}

const WHOLE = new Set(["roll", "slither", "swim"]);

async function main() {
  const list = process.argv.includes("--top") ? popular() : RACE_ENTRANTS.filter((e) => !only || only.includes(e.key));
  let need = 0, moving = 0;
  const missing: string[] = [];
  const byMotion = new Map<string, { n: number; limbs: number; legs: number }>();
  const gaps: string[] = [];
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  let k = 0;
  for (const e of list) {
    const { map, pm } = await partsOf(e);
    const row = byMotion.get(e.motion) ?? { n: 0, limbs: 0, legs: 0 };
    row.n++;
    if (pm.parts.length) row.limbs++;
    if (pm.parts.some((p) => p.kind === "leg")) row.legs++;
    byMotion.set(e.motion, row);
    const legged = e.motion === "run" || e.motion === "gallop" || e.motion === "scuttle";
    if (!WHOLE.has(e.motion)) {
      need++;
      if (pm.parts.some((p) => p.kind !== "tail")) moving++;
      else missing.push(`${e.name} (${e.motion}: ${describeParts(pm)})`);
    }
    if (legged && !pm.parts.some((p) => p.kind === "leg")) gaps.push(`${e.name} (${e.motion}: ${describeParts(pm)})`);
    if (process.argv.includes("--list")) console.log(`${e.key}\t${e.motion}\t${pm.facing < 0 ? "faces left" : "faces right"}\t${describeParts(pm)}`);
    if (png) {
      const t = await tile(e, map, pm);
      const left = (k % 6) * 262, top = Math.floor(k / 6) * 280;
      tiles.push({ input: t.svg, left, top }, { input: t.pic, left, top: top + 18 });
      k++;
    }
  }
  for (const [m, r] of byMotion) console.log(`${m.padEnd(8)} ${String(r.n).padStart(5)} runners · ${r.limbs} with moving parts · ${r.legs} with legs`);
  console.log(`\n${list.length} runners audited; ${moving} of ${need} that move their limbs have moving legs, arms or wings (the other ${list.length - need} roll, slither or swim).`);
  if (missing.length) console.log(`Without moving legs, arms or wings:\n${missing.join("\n")}\n`);
  console.log(`\n${gaps.length} runners that run, gallop or scuttle with no legs found (they keep whole-body motion):\n${gaps.join("\n")}`);
  if (png && k) await sharp({ create: { width: 6 * 262, height: Math.ceil(k / 6) * 280, channels: 3, background: "#000" } }).composite(tiles).png().toFile(png);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
