/**
 * Records one hero clip from the real site, then encodes it.
 *
 *   node scripts/hero-videos/record.mjs <clip> <desktop|phone> [--base=http://localhost:3000] [--no-encode]
 *
 * <clip> is a file in scripts/hero-videos/clips/ exporting `setup` (what the
 * take needs: viewport, date) and `run(rec, ctx)` (the play, which calls
 * rec.start() when the take begins and may rec.mark("in"/"out") the cut).
 * See README.md.
 */
import path from "node:path";
import { Recorder } from "./lib.mjs";
import { encode } from "./encode.mjs";

const [clip, form = "desktop", ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map((a) => a.replace(/^--/, "").split("=")));
const base = flags.base ?? process.env.HERO_BASE ?? "http://localhost:3000";
const phone = form === "phone";
const mod = await import(path.resolve("scripts/hero-videos/clips", `${clip}.mjs`));
const setup = { fps: 60, ...(mod.setup?.(phone) ?? {}) };
const name = `${clip}-${phone ? "phone" : "desktop"}`;
const rec = new Recorder({
  name,
  phone,
  viewport: setup.viewport ?? (phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }),
  fps: setup.fps,
  time: setup.time,
  init: setup.init,
  seed: setup.seed,
});
const t0 = Date.now();
try {
  await rec.open();
  await mod.run(rec, { base, phone });
  if (rec.recording) await rec.stop();
} catch (e) {
  console.error(`\n${name}: ${e.stack ?? e}`);
  await rec.page?.screenshot({ path: path.join(rec.dir, "..", `${name}-error.png`) }).catch(() => {});
  await rec.close();
  process.exit(1);
}
const errs = rec.errors.filter((e) => !/favicon|Failed to load resource.*(404|429)/.test(e));
if (errs.length) console.log(`\n${name}: page errors:\n  ${errs.join("\n  ")}`);
await rec.close();
console.log(`\n${name}: ${rec.frame} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
if (flags["no-encode"] === undefined) encode(name, name, { from: rec.marks.in ?? 0, to: rec.marks.out, ...(mod.encode?.(phone) ?? {}) });
