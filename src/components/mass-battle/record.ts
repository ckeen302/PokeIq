import { Director } from "@/lib/mass-battle/director";
import { answerText, fmt, questionText, resultTitle, spreadText } from "@/lib/mass-battle/copy";
import { EV, SPREAD_REACH, TICK_HZ } from "@/lib/mass-battle/constants";
import { figureSize } from "@/lib/mass-battle/stats";
import type { MBSpecies } from "@/lib/mass-battle/types";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { BATTLE_MUSIC_URL } from "./audio";
import type { BattleDesc } from "./MassBattleExperience";
import { sliceRoster, specIds } from "./protocol";
import { getRoster } from "./roster-client";
import { createBattleScene, QUALITY, TEX_URL, type Quality } from "./scene";
import { BattleView, summarize } from "./view";
import { SimClient } from "./workers";

/**
 * "Make a video": the battle as a vertical 1080 × 1920 MP4, rendered frame
 * by frame at the export quality (so it's smooth however slow the device),
 * cut by the director. A hook card opens it ("How many Magikarp does it
 * take to beat Arceus? 😳"), the answer is revealed after the battle, a
 * watermark runs throughout and an end card closes it with the link.
 * Frames go through WebCodecs (H.264); the soundtrack (the CC0 music with
 * a swell at the final blow, and the battle's hits as they land) is mixed
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

interface Cue {
  t: number;
  kind: "hit" | "boom" | "recall";
  type: string;
  power: number;
}

/** The video's parts (seconds): hook over the opening, the battle, the answer, the end card. */
export function videoPlan(seconds: number) {
  const k = Math.min(1, seconds / 15);
  const hook = 2.4 * k, reveal = 2.6 * k, end = 2.6 * k;
  return { hook, battle: Math.max(0.5, seconds - hook - reveal - end), reveal, end };
}

export const videoFileName = (slug: string, seconds: number, ext: "mp4" | "webm") =>
  `pokeiq-mass-battle-${slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "battle"}-${seconds}s.${ext}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fade = (t: number, a: number, b: number, f = 0.35) => (t < a || t > b ? 0 : Math.min(1, (t - a) / f, (b - t) / f));

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

function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, font: string, fill: string | CanvasGradient, weight = 800) {
  g.font = `${weight} ${px}px ${font}`;
  g.lineJoin = "round";
  g.strokeStyle = "#0d1626";
  g.lineWidth = px * 0.2;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
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
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate: 9_000_000, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };
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

/** The soundtrack: the music trimmed with fades and a swell at the final blow, and the battle's hits mixed in. */
async function mixAudio(seconds: number, cues: Cue[], finaleAt: number, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const Ctx = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)!;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    const data = await (await fetch(BATTLE_MUSIC_URL, { signal })).arrayBuffer();
    const music = await ctx.decodeAudioData(data);
    const src = ctx.createBufferSource();
    src.buffer = music;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.55, Math.min(0.8, seconds * 0.2));
    g.gain.setValueAtTime(0.55, Math.max(0.8, finaleAt - 0.3));
    g.gain.linearRampToValueAtTime(0.95, Math.min(seconds - 0.5, finaleAt + 0.9));
    g.gain.setValueAtTime(0.95, Math.max(finaleAt + 0.9, seconds - 1.4));
    g.gain.linearRampToValueAtTime(0, seconds);
    src.connect(g).connect(ctx.destination);
    src.start(0, Math.min(8, Math.max(0, music.duration - seconds - 1) * 0.15));
    const noise = ctx.createBuffer(1, Math.ceil(rate * 1.2), rate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const tone = (t: number, type: OscillatorType, f0: number, f1: number, gain: number, dur: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(gain, t + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(gg).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const hiss = (t: number, freq: number, gain: number, dur: number) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(gain, t + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      s.connect(f).connect(gg).connect(ctx.destination);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.05);
    };
    let last = -1;
    for (const c of cues) {
      if (c.t < 0 || c.t > seconds - 0.2) continue;
      if (c.kind === "boom") { tone(c.t, "sine", 90, 32, 0.45 * c.power, 0.9); continue; }
      if (c.kind === "recall") { tone(c.t, "sine", 520, 1400, 0.04, 0.25); continue; }
      if (c.t - last < 0.06) continue;
      last = c.t;
      tone(c.t, "sine", 150, 48, 0.25 * c.power, 0.18);
      const f = c.type === "Fire" ? 1800 : c.type === "Water" ? 900 : c.type === "Electric" ? 3800 : c.type === "Ground" || c.type === "Rock" ? 260 : 1300;
      hiss(c.t, f, 0.16 * c.power, 0.25);
    }
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
    const view = new BattleView(ready, QUALITY[quality].cap);
    const bosses = new Set<number>();
    const counts = new Map<number, number>();
    for (let i = 0; i < ready.n; i++) counts.set(ready.sp[i], (counts.get(ready.sp[i]) ?? 0) + 1);
    species.forEach((s, k) => { if ((counts.get(k) ?? 0) <= 3 && (ready.start[0] <= 3 || ready.start[1] <= 3)) bosses.add(s.id); });
    await scene.deploy({ arena: b.spec.arena, radius: ready.arena, species, bosses, view }, (p) => o.onProgress(0.01 + p * 0.07, "Deploying armies"), o.signal);
    // Frames from the worker, on demand.
    let waiting: (() => void) | null = null;
    sim.onFrames = (frames, end) => {
      view.push(frames, end);
      waiting?.();
    };
    const until = async (t: number) => {
      while (!view.end && view.head < t + 0.1) {
        await new Promise<void>((r) => {
          waiting = r;
          sim.step(Math.max(4, Math.ceil((t + 0.4 - view.head) * TICK_HZ)));
        });
        waiting = null;
      }
    };
    // Effects and sound cues from the hits.
    const cues: Cue[] = [];
    let videoT = 0;
    let finaleAt = plan.hook + plan.battle;
    let action = -1;
    const bossSide = ready.start[0] <= 3 && ready.start[1] >= 4 ? 0 : ready.start[1] <= 3 && ready.start[0] >= 4 ? 1 : -1;
    const director = new Director();
    let kos = 0;
    view.onHit = (h) => {
      const mv = h.slot >= 0 ? ready.moves[ready.sp[h.actor]][h.slot] : null;
      const ht = heights[ready.sp[h.target]], ha = heights[ready.sp[h.actor]];
      if (h.flags & EV.KO) {
        if (view.draw[h.target]) scene.effects.recall(h.tx, 0, h.tz, ht, h.t + 0.22);
        cues.push({ t: videoT, kind: "recall", type: "", power: 0.5 });
        if (bossSide >= 0 && view.side[h.target] === bossSide) {
          director.offer({ kind: "ko-boss", x: h.tx, z: h.tz, h: ht, power: 1 });
          cues.push({ t: videoT, kind: "boom", type: "", power: 1 });
          finaleAt = videoT;
        }
      }
      if (!mv || h.flags & EV.RECOIL) return;
      if (h.action !== action) {
        action = h.action;
        kos = 0;
        if (mv.spread && h.flags & EV.SPREAD) scene.effects.ring(mv.type, h.ax, h.az, ready.radius[ready.sp[h.actor]] + SPREAD_REACH + 0.4, 0.6, h.t);
        else if (!mv.contact) scene.effects.beam(mv.type, { x: h.ax, y: ha * 0.6, z: h.az }, { x: h.tx, y: ht * 0.5, z: h.tz }, Math.min(0.6, Math.max(0.04, ha * 0.07)), 0.34, h.t);
        cues.push({ t: videoT, kind: "hit", type: mv.type, power: Math.min(1, 0.3 + h.damage / Math.max(1, ready.maxHp[ready.sp[h.target]])) });
      }
      if (h.flags & EV.KO && ++kos === 5) {
        director.offer({ kind: "multi", x: h.ax, z: h.az, h: ha, power: 0.8 });
        cues.push({ t: videoT, kind: "boom", type: "", power: 0.7 });
      }
      if (h.flags & EV.CRIT && bossSide >= 0 && view.side[h.target] === bossSide) director.offer({ kind: "crit", x: h.tx, z: h.tz, h: ht, power: 0.6 });
      if (h.flags & (EV.MISS | EV.IMMUNE)) return;
      const share = Math.min(1, h.damage / Math.max(1, ready.maxHp[ready.sp[h.target]]));
      const size = Math.min(1.6, Math.max(0.3, Math.min(ht, ha * 1.5) * 0.7));
      scene.effects.burst(mv.type, h.tx, ht * 0.5, h.tz, 4 + share * 12, 1.2 + share * 4 + size, size, h.t);
    };
    director.reset(summarize(view, heights, "deploy", W / H));
    // The battle plays at its own pace when it fits, faster when it doesn't (slow-motion cuts included).
    const slowCuts = Math.min(4, ahead.moments.filter((m) => m.kind !== "final").length);
    const speed = Math.max(1, (ahead.seconds + 1.2 + slowCuts * 0.9) / plan.battle);
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const font = o.font;
    const names = b.names;
    const hookText = b.question ? `${questionText(names[0], names[1])} 😳` : b.hook;
    const total = (s: 0 | 1) => ready.start[s];
    const drawFrame = async (i: number) => {
      const t = i / fps;
      videoT = t;
      const dt = 1 / fps;
      const battleOn = t >= plan.hook;
      if (battleOn && !view.ended) {
        const rate = speed * director.timeScale;
        await until(view.t + dt * rate);
        view.advance(dt * rate);
      } else if (view.ended) {
        view.advance(dt);
      }
      const phase = !battleOn ? "deploy" : view.ended ? "ended" : "battle";
      const pose = director.update(summarize(view, heights, phase, W / H), dt);
      scene.setCamera(pose);
      scene.render(view, dt);
      g.drawImage(scene.canvas, 0, 0, W, H);
      g.textAlign = "center";
      g.textBaseline = "middle";
      // Army counters, clear of the platforms' top bar.
      if (battleOn && t < seconds - plan.end) {
        const y = H * 0.135;
        for (const s of [0, 1] as const) {
          const x = s === 0 ? W * 0.26 : W * 0.74;
          const hide = !!b.answer && s === 0 && t < plan.hook + plan.battle;
          outlined(g, names[s].length > 18 ? `${names[s].slice(0, 17)}…` : names[s], x, y, W * 0.036, font, s === 0 ? "#9fd0ff" : "#ffb3a6");
          outlined(g, hide ? "?" : fmt(view.left[s]), x, y + W * 0.05, W * 0.05, font, "#ffffff");
          g.fillStyle = "rgba(255,255,255,0.18)";
          g.fillRect(x - W * 0.17, y + W * 0.085, W * 0.34, W * 0.012);
          g.fillStyle = s === 0 ? "#4f9bff" : "#ff5a64";
          g.fillRect(x - W * 0.17, y + W * 0.085, W * 0.34 * (view.left[s] / Math.max(1, total(s))), W * 0.012);
        }
      }
      // Watermark.
      g.save();
      g.globalAlpha = 0.62;
      const wm = W * 0.034;
      if (logo) g.drawImage(logo, W * 0.05, H * 0.07 - wm * 0.55, wm * 1.1, wm * 1.1);
      g.textAlign = "left";
      outlined(g, "PokéIQ", W * 0.05 + wm * 1.35, H * 0.07, wm, font, "#ffffff");
      g.restore();
      g.textAlign = "center";
      // Hook card.
      const a = fade(t, -1, plan.hook + 0.3, 0.4);
      if (a > 0) {
        g.save();
        g.globalAlpha = a;
        const grad = g.createLinearGradient(0, H * 0.18, 0, H * 0.5);
        grad.addColorStop(0, "rgba(8,14,32,0)");
        grad.addColorStop(0.25, "rgba(8,14,32,0.72)");
        grad.addColorStop(0.75, "rgba(8,14,32,0.72)");
        grad.addColorStop(1, "rgba(8,14,32,0)");
        g.fillStyle = grad;
        g.fillRect(0, H * 0.18, W, H * 0.32);
        g.font = `800 ${W * 0.085}px ${font}`;
        const lines = wrap(g, hookText.replace(/ (\p{Extended_Pictographic}+)$/u, " $1"), W * 0.86);
        const lh = W * 0.1;
        const y0 = H * 0.34 - ((lines.length - 1) * lh) / 2;
        const fill = g.createLinearGradient(0, y0 - lh, 0, y0 + lines.length * lh);
        fill.addColorStop(0, "#fff27a");
        fill.addColorStop(1, "#ffb000");
        lines.forEach((l, k) => outlined(g, l, W / 2, y0 + k * lh, W * 0.085, font, fill));
        outlined(g, "POKÉMON MASS BATTLE · REAL BATTLE MATHS", W / 2, y0 + lines.length * lh + W * 0.01, W * 0.03, font, "#9fd8ff");
        g.restore();
      }
      // The answer (or the result).
      const r = fade(t, plan.hook + plan.battle, seconds - plan.end + 0.2, 0.3);
      if (r > 0) {
        g.save();
        g.globalAlpha = r;
        g.fillStyle = "rgba(8,12,26,0.55)";
        g.fillRect(0, H * 0.3, W, H * 0.32);
        if (b.answer) {
          outlined(g, "IT TAKES", W / 2, H * 0.37, W * 0.06, font, "#ffffff");
          const pop = 1 + 0.12 * Math.max(0, 1 - (t - plan.hook - plan.battle) / 0.4);
          outlined(g, fmt(b.answer.n), W / 2, H * 0.45, W * 0.2 * pop, font, "#ffd84a");
          outlined(g, names[0].toUpperCase(), W / 2, H * 0.53, W * 0.075, font, "#ffffff");
          outlined(g, spreadText(b.answer.spread, b.answer.runs), W / 2, H * 0.585, W * 0.034, font, "#9fd8ff");
        } else {
          const o2 = view.end?.outcome;
          const title = o2 ? resultTitle(o2.winner, names, o2.left) : "";
          g.font = `800 ${W * 0.09}px ${font}`;
          const lines = wrap(g, title.toUpperCase(), W * 0.86);
          lines.forEach((l, k) => outlined(g, l, W / 2, H * 0.42 + k * W * 0.1, W * 0.09, font, "#ffd84a"));
          if (o2 && o2.winner !== 2) outlined(g, `${fmt(o2.left[o2.winner])} LEFT STANDING`, W / 2, H * 0.42 + lines.length * W * 0.1 + W * 0.02, W * 0.045, font, "#ffffff");
        }
        g.restore();
      }
      // End card.
      const e = fade(t, seconds - plan.end, seconds + 1, 0.45);
      if (e > 0) {
        g.save();
        g.globalAlpha = e;
        g.fillStyle = "rgba(8,12,26,0.8)";
        g.fillRect(0, 0, W, H);
        const s = W * 0.26;
        if (logo) g.drawImage(logo, W / 2 - s / 2, H * 0.34 - s / 2, s, s);
        outlined(g, "PokéIQ", W / 2, H * 0.34 + s * 0.72, W * 0.11, font, "#ffffff");
        outlined(g, b.answer ? answerText(b.answer.n, names[0]) : "Make your own battle", W / 2, H * 0.52, W * 0.05, font, "#ffd21f");
        outlined(g, LINK_TEXT, W / 2, H * 0.58, W * 0.04, font, "#9fd8ff");
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
    const mix = acodec ? await mixAudio(seconds, cues, Math.min(finaleAt, seconds - plan.end), rate, o.signal) : null;
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
    const slug = b.presetId ?? (b.question ? `${names[0]}-vs-${names[1]}` : `${names[0]}-vs-${names[1]}`);
    return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: videoFileName(slug, seconds, "mp4"), type: "video/mp4" };
  } finally {
    sim.dispose();
    scene.dispose();
    host.remove();
  }
}
