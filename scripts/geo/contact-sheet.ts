/**
 * A batch's contact sheets for its pull request: every new shot in an upload
 * plan, as it will go up (the encoded file `harvest.ts prepare` kept in
 * .data/harvest/<region>/prepared/), grouped by place, with its id. Also adds
 * up the encoded files' sizes, the storage the batch will take.
 *
 *   npx tsx scripts/geo/contact-sheet.ts scripts/geo/upload-plans/batch-1.json scripts/geo/upload-plans/batch-1-sheets
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { readCuration } from "./curate";

const ROOT = process.cwd();
const HARVEST = path.join(ROOT, ".data/harvest");
const TILE_W = 320;
const TILE_H = 180;
const LABEL_H = 16;
const HEAD_H = 26;
const COLS = 5;
const PAD = 6;
const SHEET_H = 2400;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (w: number, h: number, s: string, size: number, bold = false, fill = "#fff", bg = "#333") =>
  Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${bg}"/><text x="4" y="${h - 5}" font-family="DejaVu Sans, sans-serif" font-size="${size}" ${bold ? 'font-weight="bold"' : ""} fill="${fill}">${esc(s)}</text></svg>`,
  );

function preparedFile(id: string): string | null {
  for (const region of readdirSync(HARVEST)) {
    const f = path.join(HARVEST, region, "prepared", `${id}.webp`);
    if (existsSync(f)) return f;
  }
  return null;
}

async function main() {
  const [planPath, outDir] = process.argv.slice(2);
  if (!planPath || !outDir) throw new Error("usage: contact-sheet.ts plan.json out-dir");
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as { id: string }[];
  const added = new Map(readCuration().added.map((a) => [a.id, a]));
  const groups = new Map<string, { id: string; file: string }[]>();
  let bytes = 0;
  const missing: string[] = [];
  for (const { id } of plan) {
    const a = added.get(id);
    const file = preparedFile(id);
    if (!a || !file) {
      missing.push(id);
      continue;
    }
    bytes += statSync(file).size;
    const key = `${a.region} · ${a.parent ? `${a.parent} (${a.name})` : a.name}`;
    groups.set(key, [...(groups.get(key) ?? []), { id, file }]);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const W = COLS * (TILE_W + PAD) + PAD;
  let comps: OverlayOptions[] = [];
  let y = PAD;
  let n = 0;
  const flush = async () => {
    if (!comps.length) return;
    await sharp({ create: { width: W, height: y, channels: 3, background: "#1b1b1b" } })
      .composite(comps)
      .jpeg({ quality: 78 })
      .toFile(path.join(outDir, `${String(n++).padStart(2, "0")}.jpg`));
    comps = [];
    y = PAD;
  };
  for (const [place, shots] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = Math.ceil(shots.length / COLS);
    const h = HEAD_H + rows * (TILE_H + LABEL_H + PAD);
    if (y + h > SHEET_H) await flush();
    comps.push({ input: text(W - 2 * PAD, HEAD_H - 4, `${place} (${shots.length})`, 15, true, "#fff", "#2f5d8a"), left: PAD, top: y });
    y += HEAD_H;
    for (const [i, s] of shots.entries()) {
      const x = PAD + (i % COLS) * (TILE_W + PAD);
      const top = y + Math.floor(i / COLS) * (TILE_H + LABEL_H + PAD);
      comps.push({ input: await sharp(s.file).resize(TILE_W, TILE_H, { fit: "contain", background: "#000" }).png().toBuffer(), left: x, top });
      comps.push({ input: text(TILE_W, LABEL_H, s.id, 11, false, "#ddd", "#1b1b1b"), left: x, top: top + TILE_H });
    }
    y += rows * (TILE_H + LABEL_H + PAD);
  }
  await flush();
  console.log(`${plan.length - missing.length} shots in ${groups.size} places on ${n} sheets in ${outDir}`);
  console.log(`encoded size: ${(bytes / 1024 / 1024).toFixed(1)} MB (${Math.round(bytes / Math.max(1, plan.length - missing.length) / 1024)} KB a shot)`);
  if (missing.length) console.log(`no prepared file or curation entry for: ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
