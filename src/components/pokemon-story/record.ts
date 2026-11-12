import { SITE_URL } from "@/lib/site";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { STORY_PATH } from "@/lib/pokemon-story/deeplink";
import { CHAPTERS, STORY, sourceOf } from "@/lib/pokemon-story/data";
import { filmBeats, filmLine } from "@/lib/world-history/data";
import { basisTag, type Beat, type Chapter } from "@/lib/pokemon-story/types";
import { beatIndexAt, videoAt, videoSegmentAt, type Film, type VideoPlan } from "@/lib/world-history/timing";
import { renderVideoAudio } from "./audio";
import { createStoryScene, type Quality } from "./scene";

/**
 * "Make a video": the whole story in 60 seconds, or one chapter, as a
 * vertical 1080 × 1920 MP4. Rendered frame by frame at the export quality
 * (so it is smooth however slowly this computer draws), encoded with
 * WebCodecs (H.264, and the film's own mix of music and sound, rendered
 * offline, as AAC or Opus) and muxed into an MP4; without WebCodecs it
 * records a WebM in real time. The museum captions, a title card, the
 * watermark and an end card are drawn over the frames.
 */

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
const FPS = 30;
const SITE = new URL(SITE_URL).host;
export const LINK_TEXT = `${SITE}${STORY_PATH}`;

export interface RecordOptions {
  film: Film;
  plan: VideoPlan;
  /** Title card: the hook (story) or the chapter. */
  hook: string;
  kicker: string;
  slug: string;
  serif: string;
  sans: string;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function videoFileName(slug: string, seconds: number, ext: "mp4" | "webm"): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "story";
  return `pokeiq-story-${safe}-${Math.round(seconds)}s.${ext}`;
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/ +/)) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width > maxW && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

const fade = (t: number, a: number, b: number, d = 0.35) => Math.max(0, Math.min(1, (t - a) / d, (b - t) / d));

function shadowText(g: CanvasRenderingContext2D, text: string, x: number, y: number, blur: number) {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.85)";
  g.shadowBlur = blur;
  g.fillText(text, x, y);
  g.restore();
  g.fillText(text, x, y);
}

/** The caption block: the narration, someone's words (in quotes), and the source. */
function drawCaption(g: CanvasRenderingContext2D, W: number, H: number, c: Chapter, b: Beat, alpha: number, o: { serif: string; sans: string }) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createLinearGradient(0, H * 0.52, 0, H);
  grad.addColorStop(0, "rgba(3,2,7,0)");
  grad.addColorStop(0.35, "rgba(3,2,7,0.62)");
  grad.addColorStop(1, "rgba(3,2,7,0.9)");
  g.fillStyle = grad;
  g.fillRect(0, H * 0.52, W, H * 0.48);
  const x = W * 0.08, maxW = W * 0.8;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  // The game's words, in the film's serif.
  g.font = `italic 500 ${W * 0.06}px ${o.serif}`;
  const lines = wrap(g, b.quote ? `“${filmLine(b)}”` : filmLine(b), maxW).slice(0, 6);
  const lh = W * 0.072;
  const top = H * 0.735 - (lines.length * lh) / 2;
  if (b.lead) {
    g.font = `500 ${W * 0.036}px ${o.serif}`;
    g.fillStyle = "rgba(255,255,255,0.85)";
    const lead = wrap(g, b.lead, maxW).slice(0, 3);
    lead.forEach((l, k) => shadowText(g, l, x, top - W * 0.035 - (lead.length - 1 - k) * W * 0.046, 12));
  }
  g.font = `${b.quote ? "italic " : ""}500 ${W * 0.06}px ${o.serif}`;
  g.fillStyle = "#ffffff";
  lines.forEach((l, k) => shadowText(g, l, x, top + (k + 1) * lh, 18));
  // Tag and source.
  const src = sourceOf(c, b);
  const tag = basisTag(b.basis);
  let sx = x;
  const sy = top + (lines.length + 1) * lh + W * 0.02;
  g.font = `600 ${W * 0.024}px ${o.sans}`;
  if (tag) {
    const tw = g.measureText(tag.toUpperCase()).width + W * 0.03;
    g.strokeStyle = c.accent;
    g.lineWidth = 2;
    g.strokeRect(sx, sy - W * 0.03, tw, W * 0.042);
    g.fillStyle = c.accent;
    g.fillText(tag.toUpperCase(), sx + W * 0.015, sy);
    sx += tw + W * 0.02;
  }
  g.fillStyle = "rgba(255,255,255,0.7)";
  const srcLine = wrap(g, `${src.publisher} · ${src.year}`, W * 0.84 - (sx - x));
  srcLine.slice(0, 2).forEach((l, k) => shadowText(g, l, sx, sy + k * W * 0.036, 10));
  g.restore();
}

/** The chapter's name at the top. */
function drawChapterTag(g: CanvasRenderingContext2D, W: number, H: number, c: Chapter, alpha: number, o: { serif: string; sans: string }) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createLinearGradient(0, 0, 0, H * 0.24);
  grad.addColorStop(0, "rgba(3,2,7,0.75)");
  grad.addColorStop(1, "rgba(3,2,7,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H * 0.24);
  g.textAlign = "center";
  g.font = `600 ${W * 0.026}px ${o.sans}`;
  g.fillStyle = c.accent;
  shadowText(g, `${c.numeral} · ${c.when.toUpperCase()}`, W / 2, H * 0.165, 10);
  g.font = `600 ${W * 0.056}px ${o.serif}`;
  g.fillStyle = "#ffffff";
  shadowText(g, c.title, W / 2, H * 0.2, 16);
  g.restore();
}

function drawCards(g: CanvasRenderingContext2D, W: number, H: number, t: number, plan: VideoPlan, o: RecordOptions, logo: HTMLImageElement | null) {
  // Watermark.
  g.save();
  g.globalAlpha = 0.6;
  const wm = W * 0.03;
  if (logo) g.drawImage(logo, W * 0.05, H * 0.11 - wm * 0.55, wm * 1.1, wm * 1.1);
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = `700 ${wm}px ${o.sans}`;
  g.fillStyle = "#ffffff";
  shadowText(g, "PokéIQ", W * 0.05 + wm * 1.35, H * 0.11, 8);
  g.restore();
  // Title card.
  const a = fade(t, -1, plan.hook, 0.45);
  if (a > 0) {
    g.save();
    g.globalAlpha = a;
    g.fillStyle = "rgba(3,2,7,0.55)";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${W * 0.03}px ${o.sans}`;
    g.fillStyle = "#e8c15a";
    shadowText(g, o.kicker.toUpperCase(), W / 2, H * 0.36, 12);
    g.font = `600 ${W * 0.088}px ${o.serif}`;
    g.fillStyle = "#ffffff";
    const lines = wrap(g, o.hook, W * 0.84);
    lines.forEach((l, k) => shadowText(g, l, W / 2, H * 0.43 + k * W * 0.1, 24));
    g.restore();
  }
  // End card.
  const e = fade(t, plan.endAt, plan.seconds + 1, 0.5);
  if (e > 0) {
    g.save();
    g.globalAlpha = e;
    g.fillStyle = "rgba(3,2,7,0.82)";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const s = W * 0.2;
    if (logo) g.drawImage(logo, W / 2 - s / 2, H * 0.33 - s / 2, s, s);
    g.font = `600 ${W * 0.07}px ${o.serif}`;
    g.fillStyle = "#ffffff";
    wrap(g, STORY.title, W * 0.84).forEach((l, k) => shadowText(g, l, W / 2, H * 0.47 + k * W * 0.082, 20));
    g.font = `600 ${W * 0.032}px ${o.sans}`;
    g.fillStyle = "#e8c15a";
    shadowText(g, "The whole film, with its sources", W / 2, H * 0.6, 10);
    g.fillStyle = "#cfe0ff";
    g.font = `500 ${W * 0.032}px ${o.sans}`;
    shadowText(g, LINK_TEXT, W / 2, H * 0.645, 10);
    g.restore();
  }
}

export async function recordStoryVideo(o: RecordOptions): Promise<RecordResult> {
  const W = VIDEO_W, H = VIDEO_H, fps = o.fps ?? FPS;
  const plan = o.plan;
  const N = Math.round(plan.seconds * fps);
  o.onProgress(0, "Setting the scene");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const scene = createStoryScene(host, { quality: o.quality ?? "export", film: o.film, font: o.serif, size: { w: W, h: H } });
  try {
    await scene.ready;
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const segs = plan.segments;
    const ensure = async (t: number) => {
      // The chapters this moment needs (and the one it cuts to), built in turn; the rest let go.
      const seg = videoSegmentAt(plan, t);
      const i = segs.indexOf(seg);
      const need = [seg.chapter, ...(segs[i + 1] ? [segs[i + 1].chapter] : [])];
      scene.retain(need);
      for (const c of need) await scene.prepare(c);
    };
    const drawFrame = async (i: number) => {
      const t = i / fps;
      await ensure(t);
      const f = videoAt(plan, t);
      const ct = o.film.chapters[f.chapter];
      scene.frame({
        state: { kind: "chapter", index: f.chapter, anim: f.anim, film: ct.start },
        ambient: t,
        cut: f.next ? { from: { index: f.chapter, anim: f.anim }, to: { index: f.next.chapter, anim: f.next.anim }, k: f.next.k } : null,
      });
      g.drawImage(scene.canvas, 0, 0, W, H);
      // Captions: the beat on screen (each story segment quotes its chapter's moment).
      const c = CHAPTERS[f.chapter];
      const beats = filmBeats(c);
      const seg = videoSegmentAt(plan, t);
      const bi = Math.max(0, beatIndexAt(ct, f.anim));
      const beat = plan.kind === "story" ? beats.find((b) => b.id === c.video) ?? beats[bi] : beats[bi];
      const inCard = t < plan.hook - 0.2 || t > plan.endAt + 0.2;
      const capA = inCard ? 0 : fade(t, seg.t0 + 0.25, seg.t1 - (plan.cut > 0 ? plan.cut * 0.6 : -1), 0.3);
      if (plan.kind === "story") drawChapterTag(g, W, H, c, capA, o);
      if (beat) drawCaption(g, W, H, c, beat, capA, o);
      drawCards(g, W, H, t, plan, o, logo);
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
      o.onProgress(0.01, "Mixing the music");
      const rate = 48000;
      const acodec = await pickAudioCodec(rate);
      const mix = acodec ? await renderVideoAudio(o.film, plan, rate, o.signal) : null;
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
      return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: videoFileName(o.slug, plan.seconds, "mp4"), type: "video/mp4" };
    }

    // ---- Fallback: MediaRecorder in real time.
    if (typeof MediaRecorder === "undefined" || !compose.captureStream) throw new Error("This browser can't record video");
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const isMp4 = mime.startsWith("video/mp4");
    // Build every chapter the video needs first, so real time doesn't stall on loading.
    for (const s of segs) await scene.prepare(s.chapter);
    const stream = compose.captureStream(fps);
    let actx: AudioContext | null = null;
    const mix = await renderVideoAudio(o.film, plan, 48000, o.signal);
    if (mix) {
      actx = new AudioContext({ sampleRate: 48000 });
      const dest = actx.createMediaStreamDestination();
      const src = actx.createBufferSource();
      src.buffer = mix;
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      src.start();
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250);
    const t0 = performance.now();
    for (;;) {
      if (o.signal.aborted) { rec.stop(); throw new DOMException("Cancelled", "AbortError"); }
      const t = (performance.now() - t0) / 1000;
      if (t >= plan.seconds) break;
      await drawFrame(Math.floor(t * fps));
      o.onProgress(t / plan.seconds, "Recording");
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await done;
    void actx?.close();
    const type = isMp4 ? "video/mp4" : "video/webm";
    return { blob: new Blob(parts, { type }), name: videoFileName(o.slug, plan.seconds, isMp4 ? "mp4" : "webm"), type };
  } finally {
    scene.dispose();
    host.remove();
  }
}
