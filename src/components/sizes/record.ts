import { factFor, spanFact } from "@/lib/sizes/facts";
import type { SizeItem } from "@/lib/sizes/types";
import { planPlay, playAt } from "@/lib/sizes/play";
import { cardAlpha, frameCount, videoFileName, videoSettings, videoTimeline, type VideoSettings } from "@/lib/sizes/export";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { createSizesScene, type Quality, type SceneUrls } from "./scene";
import type { RefBuilders } from "./scene/figures";
import { toSceneItem } from "./scene-item";
import { drawBadges } from "./overlay";

/**
 * "Make a video": renders the line frame by frame at 1080 × 1920 with the
 * scene's export quality (bigger shadow maps, more ambient-occlusion
 * samples, the 2048 facade atlas), so the video is smooth and sharp on any
 * computer however slowly it renders. Frames are encoded with WebCodecs
 * (H.264) and the music, mixed offline with a whoosh at each pause, with
 * AAC (or Opus where AAC isn't available), then muxed into an MP4. Without
 * WebCodecs the page records a WebM in real time with MediaRecorder.
 */

export interface RecordOptions {
  items: SizeItem[];
  seconds: number;
  hook: string;
  slug: string;
  urls: SceneUrls;
  trainer?: RefBuilders["trainer"];
  font: string;
  music: string;
  logo: string;
  /** Render quality (the export's own by default; tests can ask for a lighter one). */
  quality?: Quality;
  onProgress(p: number, label: string): void;
  signal: AbortSignal;
}

export interface RecordResult {
  blob: Blob;
  name: string;
  type: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickVideoCodec(v: VideoSettings): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const cfg: VideoEncoderConfig = { codec, width: v.width, height: v.height, bitrate: v.bitrate, framerate: v.fps, avc: { format: "avc" }, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch { /* try the next */ }
  }
  return null;
}

async function pickAudioCodec(rate: number, bitrate: number): Promise<{ cfg: AudioEncoderConfig; codec: "aac" | "opus" } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const tries: [string, "aac" | "opus"][] = [["mp4a.40.2", "aac"], ["opus", "opus"]];
  for (const [codec, kind] of tries) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: 2, bitrate };
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, codec: kind };
    } catch { /* next */ }
  }
  return null;
}

/** The soundtrack: the CC0 music trimmed to the video with fades, a soft whoosh at each pause and a swell into the finale. */
async function mixAudio(url: string, seconds: number, holds: number[], finaleAt: number, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { signal });
    const data = await res.arrayBuffer();
    const Ctx = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)!;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    const music = await ctx.decodeAudioData(data);
    const src = ctx.createBufferSource();
    src.buffer = music;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.85, 0.6);
    g.gain.setValueAtTime(0.85, Math.max(0.6, finaleAt - 0.2));
    g.gain.linearRampToValueAtTime(1, finaleAt + 0.8);
    g.gain.setValueAtTime(1, Math.max(finaleAt + 0.8, seconds - 1.6));
    g.gain.linearRampToValueAtTime(0, seconds);
    src.connect(g).connect(ctx.destination);
    // Start a little into the track so short videos open on its build.
    src.start(0, Math.min(8, Math.max(0, music.duration - seconds - 1) * 0.15));
    // Whooshes: filtered noise sweeping up.
    const noise = ctx.createBuffer(1, Math.ceil(rate * 1.2), rate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    for (const at of holds) {
      if (at < 0.2 || at > seconds - 0.4) continue;
      const n = ctx.createBufferSource();
      n.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, at - 0.45);
      bp.frequency.exponentialRampToValueAtTime(2600, at + 0.1);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, at - 0.45);
      ng.gain.linearRampToValueAtTime(0.22, at - 0.05);
      ng.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      n.connect(bp).connect(ng).connect(ctx.destination);
      n.start(at - 0.45);
      n.stop(at + 0.6);
    }
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
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Text with a thick dark outline and a bright fill (the badges' game style). */
function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, font: string, fill: string | CanvasGradient, weight = 800) {
  g.font = `${weight} ${px}px ${font}`;
  g.lineJoin = "round";
  g.strokeStyle = "#0d1626";
  g.lineWidth = px * 0.2;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

export interface VideoOverlay {
  hook: string;
  font: string;
  logo: HTMLImageElement | null;
  link: string;
  watermark: string;
}

/** The video's own layers over a frame: hook card, caption, watermark and end card. */
export function drawVideoLayers(g: CanvasRenderingContext2D, W: number, H: number, t: number, seconds: number, caption: string | null, o: VideoOverlay) {
  const tl = videoTimeline(seconds);
  const font = o.font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Caption: a fun fact during each pause, above the platforms' bottom controls.
  if (caption) {
    g.save();
    g.font = `800 ${W * 0.046}px ${font}`;
    const lines = wrap(g, caption, W * 0.78);
    const lh = W * 0.058;
    const y0 = H * 0.74 - ((lines.length - 1) * lh) / 2;
    const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + W * 0.08;
    g.fillStyle = "rgba(10,16,30,0.62)";
    const bh = lines.length * lh + W * 0.04;
    g.beginPath();
    g.roundRect(W / 2 - bw / 2, y0 - lh / 2 - W * 0.02, bw, bh, W * 0.03);
    g.fill();
    lines.forEach((l, k) => outlined(g, l, W / 2, y0 + k * lh, W * 0.046, font, "#ffffff"));
    g.restore();
  }
  // Watermark.
  g.save();
  g.globalAlpha = 0.78;
  const wm = W * 0.034;
  if (o.logo) g.drawImage(o.logo, W - W * 0.05 - wm * 5.2, H * 0.085 - wm * 0.55, wm * 1.1, wm * 1.1);
  g.textAlign = "left";
  outlined(g, o.watermark, W - W * 0.05 - wm * 3.9, H * 0.085, wm, font, "#ffffff");
  g.restore();
  // Hook card.
  const a = cardAlpha(t, -1, tl.hook, 0.4);
  if (a > 0) {
    g.save();
    g.globalAlpha = a;
    const grad = g.createLinearGradient(0, H * 0.12, 0, H * 0.44);
    grad.addColorStop(0, "rgba(8,14,32,0)");
    grad.addColorStop(0.25, "rgba(8,14,32,0.72)");
    grad.addColorStop(0.75, "rgba(8,14,32,0.72)");
    grad.addColorStop(1, "rgba(8,14,32,0)");
    g.fillStyle = grad;
    g.fillRect(0, H * 0.12, W, H * 0.32);
    g.font = `800 ${W * 0.085}px ${font}`;
    const lines = wrap(g, o.hook, W * 0.86);
    const lh = W * 0.1;
    const y0 = H * 0.28 - ((lines.length - 1) * lh) / 2;
    const fill = g.createLinearGradient(0, y0 - lh, 0, y0 + lines.length * lh);
    fill.addColorStop(0, "#fff27a");
    fill.addColorStop(1, "#ffb000");
    lines.forEach((l, k) => outlined(g, l, W / 2, y0 + k * lh, W * 0.085, font, fill));
    outlined(g, "SIZE COMPARISON · LUMIOSE CITY", W / 2, y0 + lines.length * lh + W * 0.01, W * 0.034, font, "#9fd8ff");
    g.restore();
  }
  // End card.
  const e = cardAlpha(t, seconds - tl.end, seconds + 1, 0.45);
  if (e > 0) {
    g.save();
    g.globalAlpha = e;
    g.fillStyle = "rgba(8,12,26,0.78)";
    g.fillRect(0, 0, W, H);
    const s = W * 0.26;
    if (o.logo) g.drawImage(o.logo, W / 2 - s / 2, H * 0.34 - s / 2, s, s);
    outlined(g, "PokéIQ", W / 2, H * 0.34 + s * 0.72, W * 0.11, font, "#ffffff");
    outlined(g, "Make your own size video", W / 2, H * 0.52, W * 0.05, font, "#ffd21f");
    outlined(g, o.link, W / 2, H * 0.58, W * 0.044, font, "#9fd8ff");
    g.restore();
  }
}

export async function recordVideo(o: RecordOptions): Promise<RecordResult> {
  const v = videoSettings(o.seconds, o.hook);
  const W = v.width, H = v.height, fps = v.fps;
  const N = frameCount(v);
  const tl = videoTimeline(v.seconds);
  o.onProgress(0, "Setting the scene");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const scene = createSizesScene(host, { quality: o.quality ?? "export", size: { w: W, h: H }, urls: o.urls, trainer: o.trainer });
  try {
    await scene.ready;
    const { placed } = scene.setLine(o.items.map(toSceneItem));
    const lens = { vfov: 46, aspect: W / H };
    const plan = planPlay(placed, lens, { duration: v.seconds, intro: tl.intro, finale: tl.finale, hold: Math.min(1.6, v.seconds / 14) });
    const byKey = new Map(o.items.map((i) => [i.key, i]));
    const holdStarts = plan.glide.stops.map((s) => s.t0);
    const finaleAt = plan.glide.stops.find((s) => s.finale)?.t0 ?? v.seconds - 2;
    const captions = new Map(plan.glide.stops.map((s) => [s.key, s.finale ? spanFact(o.items) ?? factFor(byKey.get(s.key)!, o.items) : factFor(byKey.get(s.key)!, o.items)]));
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const layers: VideoOverlay = { hook: o.hook, font: o.font, logo, link: v.endLink, watermark: v.watermark };
    const drawFrame = async (i: number) => {
      const t = i / fps;
      const pf = playAt(plan, t, scene.heightAt);
      scene.setView(pf.view);
      await scene.settle(20000);
      scene.render(t, 1 / fps);
      g.drawImage(scene.canvas, 0, 0, W, H);
      const stop = plan.glide.stops.find((s) => t >= s.t0 && t <= s.t1);
      // Badges keep clear of the hook card while it shows.
      const hookOn = t < tl.hook;
      if (!hookOn || t > tl.hook - 0.3) drawBadges(g, scene.anchors(), pf.focus, byKey, W, H, { font: o.font, scale: 1.08, max: 3, top: H * 0.07, bottom: H * 0.3 });
      const cap = stop && t - stop.t0 > 0.25 && t < v.seconds - tl.end ? captions.get(stop.key) ?? null : null;
      drawVideoLayers(g, W, H, t, v.seconds, cap, layers);
    };

    const vcfg = await pickVideoCodec(v);
    if (vcfg) {
      // ---- WebCodecs: deterministic, frame by frame.
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
        error(e) { failure = e; },
      });
      enc.configure(vcfg);
      // Audio, mixed and encoded first (it's quick).
      o.onProgress(0.01, "Mixing the music");
      const rate = 48000;
      const acodec = await pickAudioCodec(rate, v.audioBitrate);
      const mix = acodec ? await mixAudio(o.music, v.seconds, holdStarts, finaleAt, rate, o.signal) : null;
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
          error(e) { failure = e; },
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
      for (let i = 0; i < N; i++) {
        if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (failure) throw failure;
        await drawFrame(i);
        const frame = new VideoFrame(compose, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await sleep(2);
        o.onProgress((i + 1) / N, "Rendering");
      }
      await enc.flush();
      enc.close();
      if (failure) throw failure;
      if (!description) throw new Error("The video encoder gave no decoder configuration");
      o.onProgress(1, "Packing the MP4");
      const mux = new Mp4Muxer(
        { width: W, height: H, description },
        acodec && audioChunks.length ? { codec: acodec.codec, sampleRate: rate, channels: 2, description: audioDesc ?? (acodec.codec === "aac" ? aacConfig(rate, 2) : undefined) } : undefined
      );
      for (const c of chunks) mux.addVideo(c.data, c.ts, c.dur, c.key);
      for (const c of audioChunks) mux.addAudio(c.data, c.ts, c.dur);
      const file = mux.finalize();
      return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: videoFileName(o.slug, v.seconds, "mp4"), type: "video/mp4" };
    }

    // ---- Fallback: MediaRecorder in real time (WebM).
    if (typeof MediaRecorder === "undefined" || !compose.captureStream) throw new Error("This browser can't record video");
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const stream = compose.captureStream(fps);
    let actx: AudioContext | null = null;
    const mix = await mixAudio(o.music, v.seconds, holdStarts, finaleAt, 48000, o.signal);
    if (mix) {
      actx = new AudioContext({ sampleRate: 48000 });
      const dest = actx.createMediaStreamDestination();
      const src = actx.createBufferSource();
      src.buffer = mix;
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      src.start();
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: v.bitrate });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250);
    const t0 = performance.now();
    for (;;) {
      if (o.signal.aborted) { rec.stop(); throw new DOMException("Cancelled", "AbortError"); }
      const t = (performance.now() - t0) / 1000;
      if (t >= v.seconds) break;
      await drawFrame(Math.floor(t * fps));
      o.onProgress(t / v.seconds, "Recording");
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await done;
    void actx?.close();
    return { blob: new Blob(parts, { type: "video/webm" }), name: videoFileName(o.slug, v.seconds, "webm"), type: "video/webm" };
  } finally {
    scene.dispose();
    host.remove();
  }
}
