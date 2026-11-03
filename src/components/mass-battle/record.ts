import { Director } from "@/lib/mass-battle/director";
import { answerText, bossDownLine, critLine, fmt, multiKoLine, questionText, resultTitle, spreadText } from "@/lib/mass-battle/copy";
import { TICK_HZ } from "@/lib/mass-battle/constants";
import { figureSize } from "@/lib/mass-battle/stats";
import type { ArenaId, BattleSpec, MBSpecies } from "@/lib/mass-battle/types";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { BATTLE_CROWD_URL, BATTLE_MUSIC_URL, loopPoints, noiseBuffer, synthBoom, synthHit, synthRecall, synthRiser, synthStep, synthThunder, synthWhoosh } from "./audio";
import type { BattleDesc } from "./MassBattleExperience";
import { sliceRoster, specIds } from "./protocol";
import { getRoster } from "./roster-client";
import { createBattleScene, QUALITY, TEX_URL, type Quality } from "./scene";
import { createChoreographer } from "./scene/choreo";
import { BattleView, LEAD, summarize } from "./view";
import { SimClient } from "./workers";

/**
 * "Make a video": the battle as a vertical 1080 × 1920 MP4 for TikTok,
 * rendered frame by frame at the export quality (so it's smooth however
 * slow the device), cut by the director for a tall frame.
 *
 * - A hook card pops in over the establishing shot ("How many Magikarp
 *   does it take to beat Arceus? 😳") with the matchup under it.
 * - The battle, with the armies' counters and the boss's health along the
 *   top (clear of the apps' own bars), the big moments as captions, and
 *   the same effects and slow motion as the live battle.
 * - The answer, counted up ("It takes 53 Magikarp"), or the result.
 * - A watermark throughout and an end card with the link.
 *
 * Frames go through WebCodecs (H.264); the soundtrack (the CC0 music with
 * a swell at the final blow, the colosseum's crowd, every hit with its
 * type's sound, booms, whooshes and a riser into the reveal) is mixed
 * offline and encoded as AAC (or Opus); the file is muxed with the same
 * MP4 writer Pokémon Sizes uses. Copied from Sizes' recorder pattern
 * (src/components/sizes/record.ts) and adapted to battles.
 */

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const VIDEO_LENGTHS = [15, 30, 60] as const;
export const LINK_TEXT = `${new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://pokeiq.vercel.app").host}/lab/mass-battle`;

export interface RecordOptions {
  battle: BattleDesc;
  seconds: number;
  font: string;
  logo: string;
  quality?: Quality;
  fps?: number;
  onProgress(p: number, label: string): void;
  signal: AbortSignal;
}

export interface RecordResult {
  blob: Blob;
  name: string;
  type: string;
}

type Cue =
  | { t: number; kind: "hit"; type: string; power: number; crit: boolean }
  | { t: number; kind: "boom" | "recall" | "whoosh" | "thunder" | "step"; power: number }
  | { t: number; kind: "riser"; dur: number };

/** The video's parts (seconds): hook over the opening, the battle, the answer, the end card. */
export function videoPlan(seconds: number) {
  const k = Math.min(1, seconds / 15);
  const hook = 2.6 * k, reveal = 2.8 * k, end = 2.4 * k;
  return { hook, battle: Math.max(0.5, seconds - hook - reveal - end), reveal, end };
}

export const videoFileName = (slug: string, seconds: number, ext: "mp4" | "webm") =>
  `pokeiq-mass-battle-${slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "battle"}-${seconds}s.${ext}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fade = (t: number, a: number, b: number, f = 0.35) => (t < a || t > b ? 0 : Math.min(1, (t - a) / f, (b - t) / f));
const easeOutBack = (k: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, k));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/ +/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, font: string, fill: string | CanvasGradient, weight = 800, stroke = 0.2) {
  g.font = `${weight} ${px}px ${font}`;
  g.lineJoin = "round";
  g.strokeStyle = "#0d1626";
  g.lineWidth = px * stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function pickVideoCodec(w: number, h: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate: 10_000_000, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch { /* next */ }
  }
  return null;
}

async function pickAudioCodec(rate: number): Promise<{ cfg: AudioEncoderConfig; codec: "aac" | "opus" } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, kind] of [["mp4a.40.2", "aac"], ["opus", "opus"]] as const) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: 160_000 };
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, codec: kind };
    } catch { /* next */ }
  }
  return null;
}

/** The soundtrack: the music trimmed with fades and a swell at the final blow, the colosseum's crowd, and every sound of the battle. */
async function mixAudio(seconds: number, cues: Cue[], finaleAt: number, revealAt: number, rate: number, signal: AbortSignal, arena: ArenaId): Promise<AudioBuffer | null> {
  try {
    const Ctx = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)!;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    // Everything goes through a gentle limiter so music, crowd and a pile of hits never clip.
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -7;
    out.knee.value = 6;
    out.ratio.value = 5;
    out.attack.value = 0.003;
    out.release.value = 0.22;
    out.connect(ctx.destination);
    const sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(out);
    const data = await (await fetch(BATTLE_MUSIC_URL, { signal })).arrayBuffer();
    const music = await ctx.decodeAudioData(data);
    const src = ctx.createBufferSource();
    src.buffer = music;
    const g = ctx.createGain();
    // Music: in under the hook, dipping a touch under the battle's hits, swelling at the final blow and the reveal.
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.5, Math.min(0.8, seconds * 0.2));
    g.gain.setValueAtTime(0.5, Math.max(0.8, finaleAt - 0.3));
    g.gain.linearRampToValueAtTime(0.9, Math.min(seconds - 0.5, finaleAt + 0.9));
    g.gain.setValueAtTime(0.9, Math.max(finaleAt + 0.9, seconds - 1.4));
    g.gain.linearRampToValueAtTime(0, seconds);
    src.connect(g).connect(out);
    src.start(0, Math.min(8, Math.max(0, music.duration - seconds - 1) * 0.15));
    if (arena === "colosseum") {
      try {
        const crowd = await ctx.decodeAudioData(await (await fetch(BATTLE_CROWD_URL, { signal })).arrayBuffer());
        const cs = ctx.createBufferSource();
        cs.buffer = crowd;
        cs.loop = true;
        const { start, end } = loopPoints(crowd.duration);
        cs.loopStart = start;
        cs.loopEnd = end;
        // About 6 LU under the music, roaring at the final blow.
        const level = 0.45;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0, 0);
        cg.gain.linearRampToValueAtTime(level, Math.min(1.2, seconds * 0.2));
        cg.gain.setValueAtTime(level, Math.max(1.2, finaleAt - 0.2));
        cg.gain.linearRampToValueAtTime(level * 1.8, Math.min(seconds - 0.6, finaleAt + 0.8));
        cg.gain.setValueAtTime(level * 1.8, Math.max(finaleAt + 0.8, seconds - 2.2));
        cg.gain.linearRampToValueAtTime(0, seconds);
        cs.connect(cg).connect(out);
        cs.start(0, start);
      } catch (e) {
        if (signal.aborted) throw e;
        // No crowd: the video keeps its music and hits.
      }
    }
    const noise = noiseBuffer(ctx, 3);
    let last = -1, lastRecall = -1;
    for (const c of cues) {
      if (c.t < 0 || c.t > seconds - 0.2) continue;
      if (c.kind === "boom") synthBoom(ctx, sfx, noise, c.t, c.power);
      else if (c.kind === "whoosh") synthWhoosh(ctx, sfx, noise, c.t, c.power);
      else if (c.kind === "thunder") synthThunder(ctx, sfx, noise, c.t + 0.3, c.power);
      else if (c.kind === "step") synthStep(ctx, sfx, noise, c.t, c.power);
      else if (c.kind === "riser") synthRiser(ctx, sfx, noise, c.t, c.dur, 0.1);
      else if (c.kind === "recall") {
        if (c.t - lastRecall < 0.07) continue;
        lastRecall = c.t;
        synthRecall(ctx, sfx, c.t, 0.035);
      } else if (c.kind === "hit") {
        // A few hits a moment: a crowd of them becomes a roar, not a buzz.
        if (c.t - last < 0.055 && !c.crit) continue;
        last = c.t;
        synthHit(ctx, sfx, noise, c.t, c.type, c.power, c.crit);
      }
    }
    // The reveal lands with a hit of its own.
    synthBoom(ctx, sfx, noise, revealAt, 0.7);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

export async function recordBattleVideo(o: RecordOptions): Promise<RecordResult> {
  const W = VIDEO_W, H = VIDEO_H;
  const fps = o.fps ?? 30;
  const seconds = Math.max(3, Math.min(60, Math.round(o.seconds)));
  const plan = videoPlan(seconds);
  const N = Math.round(seconds * fps);
  const b = o.battle;
  o.onProgress(0, "Setting up the battle");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const quality: Quality = o.quality ?? "export";
  const scene = createBattleScene(host, { quality, size: { w: W, h: H }, tex: TEX_URL });
  const sim = new SimClient();
  try {
    const roster = await getRoster();
    const slice = sliceRoster(roster, specIds(b.spec));
    const ready = await sim.init(slice, b.spec);
    // The same battle played ahead, for its length.
    o.onProgress(0.01, "Reading the battle");
    const ahead = await sim.plan();
    const species: MBSpecies[] = ready.species.map((id) => slice.species.find((s) => s.id === id)!);
    const heights = species.map((s) => figureSize(s).h);
    const widths = species.map((s) => figureSize(s).w);
    const view = new BattleView(ready, QUALITY[quality].cap);
    const bosses = new Set<number>();
    const counts = new Map<number, number>();
    for (let i = 0; i < ready.n; i++) counts.set(ready.sp[i], (counts.get(ready.sp[i]) ?? 0) + 1);
    species.forEach((s, k) => { if ((counts.get(k) ?? 0) <= 3 && (ready.start[0] <= 3 || ready.start[1] <= 3)) bosses.add(s.id); });
    const envSpec = b.spec as BattleSpec & { weather?: unknown; time?: unknown };
    await scene.deploy({ arena: b.spec.arena, radius: ready.arena, species, bosses, view, weather: envSpec.weather, time: envSpec.time }, (p) => o.onProgress(0.01 + p * 0.07, "Deploying armies"), o.signal);
    // Frames from the worker, on demand.
    let waiting: (() => void) | null = null;
    sim.onFrames = (frames, end) => {
      view.push(frames, end);
      waiting?.();
    };
    const until = async (t: number) => {
      while (!view.end && view.head < t + LEAD + 0.1) {
        await new Promise<void>((r) => {
          waiting = r;
          sim.step(Math.max(4, Math.ceil((t + LEAD + 0.4 - view.head) * TICK_HZ)));
        });
        waiting = null;
      }
    };
    // Effects, sound cues and captions from the hits: the same choreography as the live battle.
    const cues: Cue[] = [];
    let videoT = 0;
    let finaleAt = plan.hook + plan.battle;
    const director = new Director();
    const choreo = createChoreographer(scene.effects, view, ready, heights, widths);
    const bossSide = ready.start[0] <= 3 && ready.start[1] >= 4 ? 0 : ready.start[1] <= 3 && ready.start[0] >= 4 ? 1 : -1;
    const nameOf = (i: number) => species[ready.sp[i]]?.name ?? "";
    let caption: { text: string; at: number; gold: boolean } | null = null;
    choreo.hooks = {
      hit: (type, power, crit) => cues.push({ t: videoT, kind: "hit", type, power: Math.min(1, 0.3 + power), crit }),
      recall: () => cues.push({ t: videoT, kind: "recall", power: 0.5 }),
      punch: (x, y, z, strength, type) => {
        scene.punch(x, y, z, strength, type);
        if (strength > 0.55) cues.push({ t: videoT, kind: "boom", power: strength });
      },
      action: (a) => {
        if (a.bossKo) {
          director.offer({ kind: "ko-boss", x: a.x, z: a.z, h: a.h, power: 1 });
          cues.push({ t: videoT, kind: "boom", power: 1 });
          finaleAt = videoT;
          caption = { text: bossDownLine(nameOf(a.actor), a.move, nameOf(a.target)), at: videoT, gold: true };
        } else if (a.kos >= 3) {
          if (a.kos >= 5) {
            director.offer({ kind: "multi", x: view.x[a.actor], z: view.z[a.actor], h: heights[ready.sp[a.actor]], power: Math.min(1, a.kos / 20) });
            cues.push({ t: videoT, kind: "boom", power: Math.min(1, a.kos / 15) });
          }
          if (!caption || videoT - caption.at > 1.2 || a.kos >= 8) caption = { text: multiKoLine(nameOf(a.actor), a.move, a.kos, nameOf(a.target)), at: videoT, gold: false };
        } else if (a.crit && a.bossHit) {
          director.offer({ kind: "crit", x: a.x, z: a.z, h: a.h, power: 0.6 });
          caption = { text: critLine(nameOf(a.actor), a.move, nameOf(a.target)), at: videoT, gold: true };
        }
        if (a.bossHit && a.share > 0.3) director.offer({ kind: "big", x: a.x, z: a.z, h: a.h, power: a.share });
      },
    };
    choreo.budget = 90;
    view.onLaunch = (h) => choreo.launch(h);
    view.onHit = (h) => choreo.hit(h);
    director.onCut = (shot) => {
      if (shot === "slowmo" || shot === "impact") cues.push({ t: videoT, kind: "whoosh", power: 0.8 });
    };
    scene.onStep = (_x, _z, size) => cues.push({ t: videoT, kind: "step", power: size });
    scene.onThunder = (s) => cues.push({ t: videoT, kind: "thunder", power: s });
    director.reset(summarize(view, heights, "deploy", W / H));
    // The battle plays at its own pace when it fits, faster when it doesn't (slow-motion cuts included).
    const slowCuts = Math.min(4, ahead.moments.filter((m) => m.kind !== "final").length);
    const speed = Math.max(1, (ahead.seconds + 1.4 + slowCuts * 0.9) / plan.battle);
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const font = o.font;
    const names = b.names;
    const hookText = b.question ? `${questionText(names[0], names[1])} 😳` : b.hook;
    const total = (s: 0 | 1) => ready.start[s];
    const bossIdx = bossSide >= 0 ? Array.from({ length: ready.n }, (_, i) => i).filter((i) => ready.side[i] === bossSide) : [];
    const bossMax = bossIdx.reduce((a, i) => a + ready.maxHp[ready.sp[i]], 0);
    const bossName = bossIdx.length ? nameOf(bossIdx[0]) : "";
    let bossTrail = 1;
    const revealAt = plan.hook + plan.battle;
    cues.push({ t: 0.05, kind: "whoosh", power: 1 }, { t: Math.max(0, revealAt - 1.2), kind: "riser", dur: 1.2 });
    const drawFrame = async (i: number) => {
      const t = i / fps;
      videoT = t;
      const dt = 1 / fps;
      const battleOn = t >= plan.hook;
      const t0 = view.t;
      if (battleOn && !view.ended) {
        const rate = speed * director.timeScale;
        await until(view.t + dt * rate);
        view.advance(dt * rate);
        choreo.flush();
      } else if (view.ended) {
        view.advance(dt);
      }
      const phase = !battleOn ? "deploy" : view.ended ? "ended" : "battle";
      const pose = director.update(summarize(view, heights, phase, W / H), dt);
      scene.setCamera(pose);
      scene.render(view, dt, Math.max(0, view.t - t0));
      g.drawImage(scene.canvas, 0, 0, W, H);
      g.textAlign = "center";
      g.textBaseline = "middle";
      const inBattle = battleOn && t < revealAt + 0.3;
      // The armies' counters along the top, clear of the apps' own bar.
      if (inBattle) {
        const y = H * 0.115;
        const pw = W * 0.38, ph = W * 0.12;
        for (const s of [0, 1] as const) {
          const x = s === 0 ? W * 0.06 : W - W * 0.06 - pw;
          const hide = !!b.answer && s === 0;
          g.save();
          g.globalAlpha = 0.82;
          roundRect(g, x, y - ph / 2, pw, ph, W * 0.018);
          g.fillStyle = "rgba(10,16,36,0.72)";
          g.fill();
          g.restore();
          g.fillStyle = s === 0 ? "#4f9bff" : "#ff5a64";
          g.fillRect(s === 0 ? x : x + pw - W * 0.006, y - ph * 0.32, W * 0.006, ph * 0.64);
          g.textAlign = s === 0 ? "left" : "right";
          const tx = s === 0 ? x + W * 0.03 : x + pw - W * 0.03;
          outlined(g, (names[s].length > 16 ? `${names[s].slice(0, 15)}…` : names[s]).toUpperCase(), tx, y - ph * 0.2, W * 0.03, font, s === 0 ? "#9fd0ff" : "#ffb3a6", 800, 0.16);
          outlined(g, hide ? "?" : fmt(view.left[s]), tx, y + ph * 0.14, W * 0.052, font, "#ffffff", 800, 0.16);
          const bx = x + W * 0.03, bw = pw - W * 0.06, by = y + ph * 0.36;
          g.fillStyle = "rgba(255,255,255,0.16)";
          g.fillRect(bx, by, bw, W * 0.008);
          g.fillStyle = s === 0 ? "#5aa8ff" : "#ff6a6a";
          const share = hide ? 1 : view.left[s] / Math.max(1, total(s));
          if (s === 0) g.fillRect(bx, by, bw * share, W * 0.008);
          else g.fillRect(bx + bw * (1 - share), by, bw * share, W * 0.008);
        }
        g.textAlign = "center";
        outlined(g, "VS", W / 2, y, W * 0.04, font, "#ffd84a", 800, 0.18);
        // The boss's health.
        if (bossIdx.length && bossMax > 0) {
          let hp = 0;
          for (const k of bossIdx) hp += view.hp[k];
          const share = Math.max(0, Math.min(1, hp / bossMax));
          bossTrail = Math.max(share, bossTrail - dt * 0.6);
          const by = H * 0.17, bw = W * 0.62, bx = (W - bw) / 2, bh = W * 0.018;
          outlined(g, `👑 ${bossName.toUpperCase()}`, W / 2, by - W * 0.028, W * 0.034, font, "#ffffff", 800, 0.16);
          roundRect(g, bx - 3, by - 3, bw + 6, bh + 6, bh);
          g.fillStyle = "rgba(10,16,36,0.75)";
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.8)";
          g.fillRect(bx, by, bw * bossTrail, bh);
          const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
          grad.addColorStop(0, "#ff8a00");
          grad.addColorStop(1, "#ffe04a");
          g.fillStyle = grad;
          g.fillRect(bx, by, bw * share, bh);
        }
      }
      // Captions for the big moments, low in the middle (above the apps' captions).
      if (caption && inBattle) {
        const age = t - caption.at;
        const a = age < 0 ? 0 : Math.min(1, age / 0.12, (1.9 - age) / 0.3);
        if (a > 0) {
          g.save();
          g.globalAlpha = a;
          const pop = 0.92 + 0.08 * easeOutBack(age / 0.25);
          g.translate(W / 2, H * 0.66);
          g.scale(pop, pop);
          g.font = `800 ${W * 0.052}px ${font}`;
          const lines = wrap(g, caption.text, W * 0.78);
          lines.forEach((l, k) => outlined(g, l, 0, (k - (lines.length - 1) / 2) * W * 0.062, W * 0.052, font, caption!.gold ? "#ffe04a" : "#ffffff", 800, 0.22));
          g.restore();
        }
      }
      // Watermark.
      g.save();
      g.globalAlpha = 0.7;
      const wm = W * 0.036;
      g.textAlign = "left";
      if (logo) g.drawImage(logo, W * 0.06, H * 0.055 - wm * 0.55, wm * 1.1, wm * 1.1);
      outlined(g, "PokéIQ", W * 0.06 + wm * 1.35, H * 0.055, wm, font, "#ffffff", 800, 0.18);
      g.restore();
      g.textAlign = "center";
      // Hook card: the question pops in over the establishing shot, the matchup under it.
      const a = fade(t, -1, plan.hook + 0.25, 0.3);
      if (a > 0) {
        g.save();
        g.globalAlpha = a;
        const grad = g.createLinearGradient(0, H * 0.16, 0, H * 0.56);
        grad.addColorStop(0, "rgba(8,14,32,0)");
        grad.addColorStop(0.22, "rgba(8,14,32,0.66)");
        grad.addColorStop(0.78, "rgba(8,14,32,0.66)");
        grad.addColorStop(1, "rgba(8,14,32,0)");
        g.fillStyle = grad;
        g.fillRect(0, H * 0.16, W, H * 0.4);
        const pop = easeOutBack(t / 0.45);
        g.translate(W / 2, H * 0.32);
        g.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
        g.font = `800 ${W * 0.09}px ${font}`;
        const lines = wrap(g, hookText, W * 0.84);
        const lh = W * 0.105;
        const y0 = -((lines.length - 1) * lh) / 2;
        const fill = g.createLinearGradient(0, y0 - lh, 0, y0 + lines.length * lh);
        fill.addColorStop(0, "#fff27a");
        fill.addColorStop(1, "#ffb000");
        lines.forEach((l, k) => outlined(g, l, 0, y0 + k * lh, W * 0.09, font, fill));
        g.restore();
        g.save();
        g.globalAlpha = a * Math.min(1, Math.max(0, (t - 0.35) / 0.3));
        const vsY = H * 0.32 + (lines.length * W * 0.105) / 2 + W * 0.07;
        const left = b.answer ? `? ${names[0]}` : `${fmt(total(0))} ${names[0]}`;
        const right = `${fmt(total(1))} ${names[1]}`;
        outlined(g, `${left}  VS  ${right}`.toUpperCase(), W / 2, vsY, W * 0.045, font, "#ffffff", 800, 0.18);
        outlined(g, "POKÉMON MASS BATTLE · REAL BATTLE MATHS", W / 2, vsY + W * 0.06, W * 0.028, font, "#9fd8ff", 800, 0.16);
        g.restore();
      }
      // The answer (counted up), or the result.
      const r = fade(t, revealAt, seconds - plan.end + 0.2, 0.25);
      if (r > 0) {
        g.save();
        g.globalAlpha = r;
        const k = (t - revealAt) / 0.7;
        // A burst of light behind it.
        const rays = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.75);
        rays.addColorStop(0, "rgba(255,216,74,0.35)");
        rays.addColorStop(0.5, "rgba(255,160,40,0.12)");
        rays.addColorStop(1, "rgba(8,12,26,0)");
        g.fillStyle = "rgba(8,12,26,0.5)";
        g.fillRect(0, H * 0.27, W, H * 0.38);
        g.fillStyle = rays;
        g.fillRect(0, H * 0.2, W, H * 0.5);
        if (b.answer) {
          outlined(g, "IT TAKES", W / 2, H * 0.355, W * 0.065, font, "#ffffff");
          const pop = 1 + 0.18 * Math.max(0, 1 - Math.abs(k - 1) * 3);
          const shown = Math.round(b.answer.n * easeOut(k));
          outlined(g, fmt(Math.max(1, shown)), W / 2, H * 0.445, W * 0.22 * pop, font, "#ffd84a");
          outlined(g, names[0].toUpperCase(), W / 2, H * 0.535, W * 0.08, font, "#ffffff");
          outlined(g, spreadText(b.answer.spread, b.answer.runs), W / 2, H * 0.59, W * 0.034, font, "#9fd8ff", 800, 0.16);
        } else {
          const o2 = view.end?.outcome;
          const title = o2 ? resultTitle(o2.winner, names, o2.left) : "";
          const pop = 0.8 + 0.2 * easeOutBack(k);
          g.save();
          g.translate(W / 2, H * 0.42);
          g.scale(pop, pop);
          g.font = `800 ${W * 0.09}px ${font}`;
          const lines = wrap(g, title.toUpperCase(), W * 0.86);
          lines.forEach((l, j) => outlined(g, l, 0, (j - (lines.length - 1) / 2) * W * 0.1, W * 0.09, font, "#ffd84a"));
          g.restore();
          if (o2 && o2.winner !== 2) outlined(g, `${fmt(o2.left[o2.winner])} LEFT STANDING`, W / 2, H * 0.53, W * 0.048, font, "#ffffff");
        }
        g.restore();
      }
      // End card.
      const e = fade(t, seconds - plan.end, seconds + 1, 0.4);
      if (e > 0) {
        g.save();
        g.globalAlpha = e;
        g.fillStyle = "rgba(8,12,26,0.84)";
        g.fillRect(0, 0, W, H);
        const s = W * 0.26 * (0.9 + 0.1 * easeOutBack((t - (seconds - plan.end)) / 0.4));
        if (logo) g.drawImage(logo, W / 2 - s / 2, H * 0.33 - s / 2, s, s);
        outlined(g, "PokéIQ", W / 2, H * 0.33 + W * 0.2, W * 0.11, font, "#ffffff");
        outlined(g, b.answer ? answerText(b.answer.n, names[0]) : "Make your own battle", W / 2, H * 0.51, W * 0.05, font, "#ffd21f");
        outlined(g, LINK_TEXT, W / 2, H * 0.565, W * 0.04, font, "#9fd8ff", 800, 0.16);
        g.restore();
      }
    };
    const vcfg = await pickVideoCodec(W, H, fps);
    if (!vcfg) throw new Error("This browser can't encode video (WebCodecs is needed: try Chrome, Edge or Safari)");
    let failure: unknown = null;
    let description: Uint8Array | null = null;
    const chunks: { data: Uint8Array; ts: number; dur: number; key: boolean }[] = [];
    const enc = new VideoEncoder({
      output(chunk, meta) {
        if (meta?.decoderConfig?.description && !description) {
          const d = meta.decoderConfig.description;
          description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 1e6 / fps, key: chunk.type === "key" });
      },
      error(err) { failure = err; },
    });
    enc.configure(vcfg);
    for (let i = 0; i < N; i++) {
      if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (failure) throw failure;
      await drawFrame(i);
      const frame = new VideoFrame(compose, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 3) await sleep(2);
      o.onProgress(0.08 + ((i + 1) / N) * 0.86, "Rendering");
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    if (!description) throw new Error("The video encoder gave no decoder configuration");
    // The soundtrack, now the hits' times are known.
    o.onProgress(0.95, "Mixing the sound");
    const rate = 48000;
    const acodec = await pickAudioCodec(rate);
    const mix = acodec ? await mixAudio(seconds, cues, Math.min(finaleAt, seconds - plan.end), revealAt, rate, o.signal, b.spec.arena) : null;
    const audioChunks: { data: Uint8Array; ts: number; dur: number }[] = [];
    let audioDesc: Uint8Array | undefined;
    if (acodec && mix) {
      const aenc = new AudioEncoder({
        output(chunk, meta) {
          if (meta?.decoderConfig?.description && !audioDesc) {
            const d = meta.decoderConfig.description;
            audioDesc = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          audioChunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 0 });
        },
        error(err) { failure = err; },
      });
      aenc.configure(acodec.cfg);
      const block = 4800;
      const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
      for (let at = 0; at < mix.length; at += block) {
        const n = Math.min(block, mix.length - at);
        const planar = new Float32Array(n * 2);
        planar.set(L.subarray(at, at + n), 0);
        planar.set(R.subarray(at, at + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / rate) * 1e6), data: planar });
        aenc.encode(ad);
        ad.close();
      }
      await aenc.flush();
      aenc.close();
    }
    o.onProgress(1, "Packing the MP4");
    const mux = new Mp4Muxer({ width: W, height: H, description }, acodec && audioChunks.length ? { codec: acodec.codec, sampleRate: rate, channels: 2, description: audioDesc ?? (acodec.codec === "aac" ? aacConfig(rate, 2) : undefined) } : undefined);
    for (const c of chunks) mux.addVideo(c.data, c.ts, c.dur, c.key);
    for (const c of audioChunks) mux.addAudio(c.data, c.ts, c.dur);
    const file = mux.finalize();
    const slug = b.presetId ?? `${names[0]}-vs-${names[1]}`;
    return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: videoFileName(slug, seconds, "mp4"), type: "video/mp4" };
  } finally {
    sim.dispose();
    scene.dispose();
    host.remove();
  }
}
