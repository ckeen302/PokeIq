/**
 * Checkpoint: builds sample rounds of "Which is the real shiny?" as contact
 * sheets in a local folder. Writes nothing to Supabase and nothing to the repo.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/shiny/samples.ts <outDir> [count]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { encodeOption, loadRaw, makeDecoys, meanDeltaE, seeded, type Tier } from "./decoys";

const IDS = [25, 6, 94, 150, 130, 143, 212, 376, 448, 487, 571, 700, 745, 777, 887, 1000, 1024, 132, 81, 227, 79, 462];
const SPRITE = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${id}.png`;

async function main() {
  const [outDir, countArg] = process.argv.slice(2);
  if (!outDir) throw new Error("usage: samples.ts <outDir> [count]");
  await mkdir(outDir, { recursive: true });
  const ids = IDS.slice(0, Number(countArg) || 20);
  const report: unknown[] = [];
  for (const [round, id] of ids.entries()) {
    const res = await fetch(SPRITE(id));
    if (!res.ok) throw new Error(`sprite ${id}: HTTP ${res.status}`);
    const real = await loadRaw(Buffer.from(await res.arrayBuffer()));
    const decoys = makeDecoys(real, id * 7919);
    const options = [{ tier: "real" as Tier | "real", raw: real, deltaE: 0 }, ...decoys];
    const rnd = seeded(id * 31 + 7);
    for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
    const realPos = options.findIndex((o) => o.tier === "real") + 1;
    const buffers = await Promise.all(options.map((o) => encodeOption(o.raw)));
    const labels = options.map((_, i) => `<text x="${i * 400 + 12}" y="30" font-size="28" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${i + 1}</text>`).join("");
    const sheet = await sharp({ create: { width: 1600, height: 400, channels: 4, background: "#e8e8ee" } })
      .composite([
        ...buffers.map((input, i) => ({ input, left: i * 400 + 8, top: 8 })),
        { input: Buffer.from(`<svg width="1600" height="400" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const file = `round-${String(round + 1).padStart(2, "0")}-dex${id}-real-is-${realPos}.png`;
    await writeFile(path.join(outDir, file), sheet);
    report.push({
      file,
      id,
      realPosition: realPos,
      options: options.map((o, i) => ({ position: i + 1, tier: o.tier, meanDeltaE: +o.deltaE.toFixed(1), bytes: buffers[i].length })),
      nearToReal: +meanDeltaE(real, decoys[0].raw).toFixed(1),
    });
    console.log(file, options.map((o) => `${o.tier}:${o.deltaE.toFixed(1)}`).join(" "));
  }
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
