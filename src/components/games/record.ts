import { VIDEO_FPS } from "@/lib/sizes/export";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { CROWD_URL, APPLAUSE_URL, noiseBuffer } from "@/components/race/audio";
import { gameText } from "@/components/race/graphics";
import type { Athlete } from "@/lib/games/athlete";
import { eventOf } from "@/lib/games/events";
import { createGamesScene, type Quality, type SceneUrls } from "./scene";
import { ANTHEM_URL, FANFARE_URL, buildMixer, crowdLevels, scheduleCue, type Buffers } from "./audio";
import { drawOverlay, drawSprint, type Gfx } from "./graphics";
import type { Sequence } from "./show/sequence";
import type { SprintExtras } from "./show/sprint";
import type { Show } from "./show/types";

/**
 * "Make a video" for the Games: shows rendered frame by frame at the
 * scene's export quality into a vertical 1080 × 1920 (TikTok, Reels,
 * Shorts) or a wide 1920 × 1080 MP4: the hook card over the opening, the
 * broadcast with its graphics laid out for the frame (the phone layout for
 * the vertical video), the slow-motion replay, then the end card with the
 * medallists and the link. The sound is the live page's (the same cues
 * through the same scheduler), mixed offline. Encoded with WebCodecs
 * (H.264, and AAC or Opus) and packed by the Sizes MP4 muxer; without
 * WebCodecs the page records a WebM in real time with MediaRecorder.
 *
 * Several parts (the Games summary: every event in turn) are recorded one
 * after another on one timeline, each loaded into the scene as it starts.
 */

export type VideoFormat = "9:16" | "16:9";

export interface GamesRecordOptions {
  parts: Sequence[];
  format: VideoFormat;
  hook: string;
  /** Under the hook: "100 M · BASED ON THEIR STATS". */
  sub: string;
  /** The end card: the medallists (or the Games' champions) and the link. */
  podium: { place: string; name: string; mark: string }[];
  endTitle: string;
  slug: string;
  link: string;
  byKey: ReadonlyMap<string, Athlete>;
  urls: SceneUrls;
  font: string;
  logo: string;
  /** Force a length (tests): the start of the broadcast, then the end card. */
  seconds?: number;
  /**
   * Record only this stretch of the timeline (s) as a file of its own: a long render made in pieces that can be
   * resumed one by one and joined end to end afterwards (each starts on a key frame, its sound cut to match).
   */
  range?: { from: number; to: number };
  quality?: Quality;
  fps?: number;
  onProgress(p: number, label: string): void;
  signal: AbortSignal;
}

export interface GamesRecordResult {
  blob: Blob;
  name: string;
  type: string;
  seconds: number;
  width: number;
  height: number;
}

export const HOOK_SECONDS = 2.4;
export const END_SECONDS = 2.8;

export const videoSize = (f: VideoFormat) => (f === "9:16" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 });

/** The video's timeline: the parts end to end, then the end card. */
export function gamesVideoPlan(parts: Sequence[], seconds?: number): { total: number; end: number; offsets: number[] } {
  const offsets: number[] = [];
  let t = 0;
  for (const p of parts) { offsets.push(t); t += p.end; }
  if (seconds != null) return { total: seconds, end: Math.max(seconds * 0.6, seconds - 1.6), offsets };
  return { total: Math.ceil((t + END_SECONDS) * 10) / 10, end: t, offsets };
}

export function gamesVideoName(slug: string, format: VideoFormat, ext: "mp4" | "webm"): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "games";
  return `pokeiq-games-${safe}${format === "16:9" ? "-wide" : ""}.${ext}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickVideoCodec(w: number, h: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate: 9_000_000, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* next */ }
  }
  return null;
}

async function pickAudioCodec(rate: number): Promise<{ cfg: AudioEncoderConfig; codec: "aac" | "opus" } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, kind] of [["mp4a.40.2", "aac"], ["opus", "opus"]] as const) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: 160_000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, codec: kind }; } catch { /* next */ }
  }
  return null;
}

/** Which part plays at video time t, and the time within it. */
function partAt(parts: Sequence[], offsets: number[], t: number): { i: number; t: number } {
  let i = parts.length - 1;
  for (let k = 0; k < parts.length; k++) if (t < offsets[k] + parts[k].end) { i = k; break; }
  return { i, t: Math.max(0, Math.min(parts[i].end, t - offsets[i])) };
}

/** The sound: the crowd following each show's excitement, and every show's cues, through the live page's scheduler. */
async function mixAudio(parts: Sequence[], offsets: number[], seconds: number, aspect: number, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    const get = async (url: string) => { try { const r = await fetch(url, { signal }); return r.ok ? await ctx.decodeAudioData(await r.arrayBuffer()) : null; } catch { return null; } };
    const [crowd, applause, fanfare, anthem] = await Promise.all([get(CROWD_URL), get(APPLAUSE_URL), get(FANFARE_URL), get(ANTHEM_URL)]);
    const noise = noiseBuffer(ctx, 3);
    const mix = buildMixer(ctx, crowd, noise);
    const buf: Buffers = { noise, applause, fanfare, anthem };
    for (let t = 0; t <= seconds; t += 0.1) {
      const p = partAt(parts, offsets, t);
      const e = parts[p.i].at(p.t, aspect).excitement;
      const l = crowdLevels(e);
      const fade = Math.min(1, t / 0.5, Math.max(0, (seconds - t) / 0.9));
      mix.bed.gain.linearRampToValueAtTime(l.bed * fade, t);
      mix.roar.gain.linearRampToValueAtTime(l.roar * fade, t);
      mix.filter.frequency.linearRampToValueAtTime(l.cutoff, t);
    }
    parts.forEach((part, i) => {
      for (const c of part.cues) {
        const at = offsets[i] + c.t;
        if (at < seconds - 0.05) scheduleCue(ctx, mix.bus, buf, c.kind, at, c.gain);
      }
    });
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

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

/** The hook card, the watermark and the end card over a frame (in video pixels). */
function drawCards(g: CanvasRenderingContext2D, W: number, H: number, t: number, total: number, end: number, o: Pick<GamesRecordOptions, "hook" | "sub" | "podium" | "endTitle" | "link" | "font"> & { logo: HTMLImageElement | null }) {
  const font = o.font;
  const u = Math.min(W, H * 0.5625);
  // Watermark.
  g.save();
  g.globalAlpha = 0.62;
  const wm = u * 0.034;
  const wx = W * 0.04, wy = H > W ? H * 0.125 : H * 0.07;
  if (o.logo) g.drawImage(o.logo, wx, wy - wm * 0.55, wm * 1.1, wm * 1.1);
  g.textAlign = "left";
  g.textBaseline = "middle";
  gameText(g, "PokéIQ", wx + wm * 1.35, wy, wm, font, "#ffffff", "#0d1626", wm * 0.2);
  g.restore();
  // Hook card.
  const hookEnd = Math.min(HOOK_SECONDS, total * 0.35);
  if (t < hookEnd) {
    const a = Math.min(1, (hookEnd - t) / 0.35);
    g.save();
    g.globalAlpha = a;
    const y0c = H > W ? H * 0.28 : H * 0.42;
    const grad = g.createLinearGradient(0, y0c - u * 0.32, 0, y0c + u * 0.32);
    grad.addColorStop(0, "rgba(8,14,32,0)");
    grad.addColorStop(0.25, "rgba(8,14,32,0.74)");
    grad.addColorStop(0.75, "rgba(8,14,32,0.74)");
    grad.addColorStop(1, "rgba(8,14,32,0)");
    g.fillStyle = grad;
    g.fillRect(0, y0c - u * 0.32, W, u * 0.64);
    const px = u * 0.085;
    g.font = `800 ${px}px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lines = wrap(g, o.hook.replace(/ (\p{Extended_Pictographic}+)$/u, " $1"), Math.min(W * 0.86, u * 1.5));
    const lh = px * 1.18;
    const y0 = y0c - ((lines.length - 1) * lh) / 2;
    const fill = g.createLinearGradient(0, y0 - lh, 0, y0 + lines.length * lh);
    fill.addColorStop(0, "#fff27a");
    fill.addColorStop(1, "#ffb000");
    lines.forEach((l, i) => gameText(g, l, W / 2, y0 + i * lh, px, font, fill, "#0d1626", px * 0.2));
    gameText(g, o.sub.toUpperCase(), W / 2, y0 + lines.length * lh + u * 0.01, u * 0.034, font, "#9fd8ff", "#0d1626", u * 0.034 * 0.2);
    g.restore();
  }
  // End card: the medallists and the link.
  if (t >= end) {
    const a = Math.min(1, (t - end) / 0.45);
    g.save();
    g.globalAlpha = a;
    g.fillStyle = "rgba(8,12,26,0.84)";
    g.fillRect(0, 0, W, H);
    const s = u * 0.2;
    const cy = H > W ? H * 0.27 : H * 0.2;
    if (o.logo) g.drawImage(o.logo, W / 2 - s / 2, cy - s / 2, s, s);
    g.textAlign = "center";
    g.textBaseline = "middle";
    gameText(g, "The PokéIQ Games", W / 2, cy + s * 0.8, u * 0.075, font, "#ffffff", "#0d1626", u * 0.015);
    gameText(g, o.endTitle, W / 2, cy + s * 0.8 + u * 0.09, u * 0.045, font, "#ffd21f", "#0d1626", u * 0.009);
    const colors = ["#ffd84a", "#d7dde5", "#d58a4a"];
    o.podium.slice(0, 3).forEach((p, i) => {
      const y = cy + s * 0.8 + u * (0.2 + i * 0.085);
      g.textAlign = "center";
      const line = `${p.place}  ${p.name}  ·  ${p.mark}`;
      let lpx = u * 0.05;
      g.font = `800 ${lpx}px ${font}`;
      const lw = g.measureText(line).width;
      if (lw > W * 0.88) lpx *= (W * 0.88) / lw;
      gameText(g, line, W / 2, y, lpx, font, colors[i] ?? "#ffffff", "#0d1626", lpx * 0.18);
    });
    let lpx = u * 0.042;
    g.font = `800 ${lpx}px ${font}`;
    const lw = g.measureText(o.link).width;
    if (lw > W * 0.9) lpx *= (W * 0.9) / lw;
    gameText(g, o.link, W / 2, cy + s * 0.8 + u * 0.5, lpx, font, "#9fd8ff", "#0d1626", lpx * 0.2);
    g.restore();
  }
}

export async function recordGames(o: GamesRecordOptions): Promise<GamesRecordResult> {
  const { w: W, h: H } = videoSize(o.format);
  const fps = o.fps ?? VIDEO_FPS;
  const { total, end, offsets } = gamesVideoPlan(o.parts, o.seconds);
  const N = Math.round(total * fps);
  // The frames to render: all of them, or a piece of the timeline.
  const i0 = o.range ? Math.max(0, Math.min(N, Math.round(o.range.from * fps))) : 0;
  const i1 = o.range ? Math.max(i0, Math.min(N, Math.round(o.range.to * fps))) : N;
  const aspect = W / H;
  o.onProgress(0, "Setting the scene");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const scene = createGamesScene(host, { quality: o.quality ?? "export", size: { w: W, h: H }, urls: o.urls, font: o.font });
  // The graphics are laid out on a logical page (a 390 px wide phone for the vertical video, 960 px for the wide one) scaled up.
  const LW = o.format === "9:16" ? 390 : 960;
  const S = W / LW, LH = H / S;
  const gfx: Gfx = o.format === "9:16" ? { font: o.font, scale: 1, top: 96, bottom: 150, phone: true } : { font: o.font, scale: 1.1, top: 56, bottom: 80, phone: false };
  let loaded = -1;
  let photo: HTMLCanvasElement | null = null;
  const loadPart = async (i: number) => {
    if (i === loaded) return;
    const p = o.parts[i];
    await scene.load({ athletes: p.athletes, race: p.race, falseRace: p.falseRace ?? null, venue: p.venue }, o.signal, (k) => o.onProgress(0.03 * ((i + k) / o.parts.length), "Athletes warming up"));
    photo = null;
    // A sprint's photo finish, developed up front.
    const sp = p.parts.map((x) => x.show).find((s) => (s as Show & Partial<SprintExtras>).racePlan) as (Show & SprintExtras) | undefined;
    if (sp?.photoFrame) {
      const pf = scene.photoFinish(sp.photoFrame);
      for (let k = 0; k < 4000 && !pf.step(); k++) await sleep(0);
      photo = pf.result();
    }
    loaded = i;
  };
  try {
    await loadPart(partAt(o.parts, offsets, Math.min(i0 / fps, end - 1e-6)).i);
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const drawAt = async (i: number) => {
      const t = i / fps;
      const p = partAt(o.parts, offsets, Math.min(t, end - 1e-6));
      await loadPart(p.i);
      const seq = o.parts[p.i];
      const fr = seq.at(p.t, aspect);
      scene.frame(fr);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(scene.canvas, 0, 0, W, H);
      if (t < end) {
        g.setTransform(S, 0, 0, S, 0, 0);
        const heads = scene.heads().map((h) => ({ ...h, x: h.x / S, y: h.y / S, by: h.by / S }));
        const part = seq.partAt(p.t);
        const sp = part.show as Show & Partial<SprintExtras>;
        if (sp.racePlan) drawSprint(g, LW, LH, sp as Show & SprintExtras, p.t - part.t0, heads, photo, { ...gfx, title: `${eventOf(sp.event).name} · final` });
        else drawOverlay(g, LW, LH, seq.overlay(p.t), heads, o.byKey, gfx);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      drawCards(g, W, H, t, total, end, { ...o, logo });
    };

    const vcfg = await pickVideoCodec(W, H, fps);
    if (vcfg) {
      let failure: unknown = null;
      let description: Uint8Array | null = null;
      const chunks: { data: Uint8Array; ts: number; dur: number; key: boolean }[] = [];
      const copyDesc = (d: AllowSharedBufferSource) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength)));
      const enc = new VideoEncoder({
        output(chunk, meta) {
          if (meta?.decoderConfig?.description && !description) description = copyDesc(meta.decoderConfig.description);
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 1e6 / fps, key: chunk.type === "key" });
        },
        error(e) { failure = e; },
      });
      enc.configure(vcfg);
      o.onProgress(0.03, "Mixing the sound");
      const rate = 48000;
      const acodec = await pickAudioCodec(rate);
      const mix = acodec ? await mixAudio(o.parts, offsets, total, aspect, rate, o.signal) : null;
      const audioChunks: { data: Uint8Array; ts: number; dur: number }[] = [];
      let audioDesc: Uint8Array | undefined;
      if (acodec && mix) {
        const aenc = new AudioEncoder({
          output(chunk, meta) {
            if (meta?.decoderConfig?.description && !audioDesc) audioDesc = copyDesc(meta.decoderConfig.description);
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            audioChunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 0 });
          },
          error(e) { failure = e; },
        });
        aenc.configure(acodec.cfg);
        const block = 4800;
        const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
        // (The sound of the frames being made: all of it, or the piece's.)
        const a0 = Math.min(mix.length, Math.round((i0 / fps) * rate)), a1 = Math.min(mix.length, Math.round((i1 / fps) * rate));
        for (let at = a0; at < a1; at += block) {
          const n = Math.min(block, a1 - at);
          const planar = new Float32Array(n * 2);
          planar.set(L.subarray(at, at + n), 0);
          planar.set(R.subarray(at, at + n), n);
          const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((at - a0) / rate) * 1e6), data: planar });
          aenc.encode(ad);
          ad.close();
        }
        await aenc.flush();
        aenc.close();
      }
      for (let i = i0; i < i1; i++) {
        if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (failure) throw failure;
        await drawAt(i);
        const k = i - i0;
        const frame = new VideoFrame(compose, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: k % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await sleep(2);
        if (i % 2 === 0) await sleep(0);
        o.onProgress(0.05 + 0.95 * ((k + 1) / Math.max(1, i1 - i0)), "Rendering");
      }
      await enc.flush();
      enc.close();
      if (failure) throw failure;
      if (!description) throw new Error("The video encoder gave no decoder configuration");
      o.onProgress(1, "Packing the MP4");
      const mux = new Mp4Muxer({ width: W, height: H, description }, acodec && audioChunks.length ? { codec: acodec.codec, sampleRate: rate, channels: 2, description: audioDesc ?? (acodec.codec === "aac" ? aacConfig(rate, 2) : undefined) } : undefined);
      for (const c of chunks) mux.addVideo(c.data, c.ts, c.dur, c.key);
      for (const c of audioChunks) mux.addAudio(c.data, c.ts, c.dur);
      const file = mux.finalize();
      return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: gamesVideoName(o.slug, o.format, "mp4"), type: "video/mp4", seconds: (i1 - i0) / fps, width: W, height: H };
    }

    // Fallback: MediaRecorder in real time.
    if (typeof MediaRecorder === "undefined" || !compose.captureStream) throw new Error("This browser can't record video");
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const isMp4 = mime.startsWith("video/mp4");
    const stream = compose.captureStream(fps);
    let actx: AudioContext | null = null;
    const mix = await mixAudio(o.parts, offsets, total, aspect, 48000, o.signal);
    if (mix) {
      actx = new AudioContext({ sampleRate: 48000 });
      const dest = actx.createMediaStreamDestination();
      const src = actx.createBufferSource();
      src.buffer = mix;
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      src.start();
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
    const out: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) out.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250);
    const t0 = performance.now();
    for (;;) {
      if (o.signal.aborted) { rec.stop(); throw new DOMException("Cancelled", "AbortError"); }
      const t = (performance.now() - t0) / 1000;
      if (t >= total) break;
      await drawAt(Math.floor(t * fps));
      o.onProgress(t / total, "Recording");
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await done;
    void actx?.close();
    return { blob: new Blob(out, { type: isMp4 ? "video/mp4" : "video/webm" }), name: gamesVideoName(o.slug, o.format, isMp4 ? "mp4" : "webm"), type: isMp4 ? "video/mp4" : "video/webm", seconds: total, width: W, height: H };
  } finally {
    scene.dispose();
    host.remove();
  }
}
