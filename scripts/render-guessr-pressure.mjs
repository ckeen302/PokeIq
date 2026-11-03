/**
 * Renders PokéGuessr's countdown pressure offline (OfflineAudioContext in
 * headless Chromium, the same code the game runs) to WAVs, and checks the
 * mix: no clipping, peaks and RMS in a comfortable range, and silence right
 * after a stop.
 *
 *   node scripts/render-guessr-pressure.mjs [out-dir]
 *
 * Exits non-zero if a level check fails.
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(process.argv[2] ?? path.join(root, ".data/guessr-pressure"));
mkdirSync(out, { recursive: true });
const SR = 44100;

const bundle = await build({
  entryPoints: [path.join(root, "src/lib/guessr-pressure.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Pressure",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
const code = bundle.outputFiles[0].text;
const samples = Object.fromEntries(
  ["countdown-start", "tick", "tock", "heartbeat"].map((n) => [n, readFileSync(path.join(root, `public/audio/guessr/${n}.ogg`)).toString("base64")]),
);

/** name, options, render length (s), stop after (s, or null), recorded samples or the synthesised fallback. */
const SCENES = [
  { name: "duel-countdown-15s", opts: { leftS: 15, totalS: 15, flashS: 5, level: 1, cue: true }, len: 15.6, stop: null, recorded: true },
  { name: "duel-countdown-15s-synth", opts: { leftS: 15, totalS: 15, flashS: 5, level: 1, cue: true }, len: 15.6, stop: null, recorded: false },
  { name: "turbo-countdown-10s", opts: { leftS: 10, totalS: 10, flashS: 5, level: 1, cue: true }, len: 10.6, stop: null, recorded: true },
  { name: "duel-guess-after-6s", opts: { leftS: 15, totalS: 15, flashS: 5, level: 1, cue: true }, len: 7, stop: 6, recorded: true },
  { name: "solo-last-10s", opts: { leftS: 10, totalS: 10, flashS: 5, level: 0.55, cue: true }, len: 10.6, stop: null, recorded: true },
  { name: "solo-last-10s-synth", opts: { leftS: 10, totalS: 10, flashS: 5, level: 0.55, cue: true }, len: 10.6, stop: null, recorded: false },
  { name: "alarm-cue", opts: { leftS: 1.2, totalS: 15, flashS: 0, level: 1, cue: true }, len: 1.4, stop: null, recorded: true },
  { name: "alarm-cue-synth", opts: { leftS: 1.2, totalS: 15, flashS: 0, level: 1, cue: true }, len: 1.4, stop: null, recorded: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><title>render</title>");
await page.addScriptTag({ content: code });

function wav(int16) {
  const buf = Buffer.alloc(44 + int16.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + int16.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(int16.length * 2, 40);
  Buffer.from(int16.buffer).copy(buf, 44);
  return buf;
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const failures = [];
const rows = [];
for (const scene of SCENES) {
  const result = await page.evaluate(
    async ({ scene, samples, SR }) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(SR * scene.len), SR);
      const decoded = {};
      if (scene.recorded) {
        const map = { start: "countdown-start", tick: "tick", tock: "tock", heart: "heartbeat" };
        for (const [k, file] of Object.entries(map)) {
          const bytes = Uint8Array.from(atob(samples[file]), (c) => c.charCodeAt(0));
          decoded[k] = await ctx.decodeAudioData(bytes.buffer);
        }
      }
      const voice = new window.Pressure.PressureVoice(ctx, ctx.destination, () => decoded, scene.opts, 0);
      voice.scheduleUntil(scene.stop ?? Infinity);
      if (scene.stop !== null) {
        ctx.suspend(scene.stop).then(() => {
          voice.release(scene.stop);
          ctx.resume();
        });
      }
      const data = (await ctx.startRendering()).getChannelData(0);
      let peak = 0;
      let sum = 0;
      for (const v of data) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      // Loudness of the busiest half-second (what a player hears at the climax).
      let loudest = 0;
      const win = Math.floor(SR / 2);
      for (let i = 0; i + win <= data.length; i += Math.floor(win / 4)) {
        let s = 0;
        for (let j = i; j < i + win; j++) s += data[j] * data[j];
        loudest = Math.max(loudest, Math.sqrt(s / win));
      }
      // After a stop: the loudest sample once the release is over.
      let tail = 0;
      if (scene.stop !== null) for (let i = Math.ceil((scene.stop + 0.08) * SR); i < data.length; i++) tail = Math.max(tail, Math.abs(data[i]));
      const int16 = new Int16Array(data.length);
      for (let i = 0; i < data.length; i++) int16[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
      let bin = "";
      const bytes = new Uint8Array(int16.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { peak, rms: Math.sqrt(sum / data.length), loudest, tail, pcm: btoa(bin) };
    },
    { scene, samples, SR },
  );
  const pcm = Buffer.from(result.pcm, "base64");
  writeFileSync(path.join(out, `${scene.name}.wav`), wav(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2)));
  const row = { scene: scene.name, peakDb: db(result.peak).toFixed(1), rmsDb: db(result.rms).toFixed(1), loudest500msDb: db(result.loudest).toFixed(1), tailAfterStopDb: scene.stop === null ? "-" : db(result.tail).toFixed(1) };
  rows.push(row);
  if (result.peak >= 0.891) failures.push(`${scene.name}: peak ${row.peakDb} dBFS (over -1 dBFS)`);
  if (result.peak < 0.05) failures.push(`${scene.name}: peak ${row.peakDb} dBFS (barely audible)`);
  if (result.loudest > 0.25) failures.push(`${scene.name}: loudest half-second ${row.loudest500msDb} dBFS RMS (too loud for 5 rounds)`);
  if (scene.stop !== null && result.tail > 0.001) failures.push(`${scene.name}: still ${row.tailAfterStopDb} dBFS after the stop`);
}
await browser.close();
console.table(rows);
writeFileSync(path.join(out, "levels.json"), JSON.stringify(rows, null, 2));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`✓ levels OK. WAVs in ${out}`);
