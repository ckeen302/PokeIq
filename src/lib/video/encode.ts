import { Mp4Muxer } from "@/lib/sizes/mp4";

/**
 * Silent videos made frame by frame, for the site's video downloads: each frame is drawn onto a canvas at its own
 * moment (so the video is smooth however slowly this computer draws), encoded with WebCodecs (H.264) and muxed into
 * a fast-start MP4 (lib/sizes/mp4.ts) that plays and uploads anywhere, TikTok included. Without WebCodecs it records
 * a WebM in real time with MediaRecorder instead.
 *
 * The pattern each video maker on the site copies (pokemon-story/record.ts and friends), in one place for new ones.
 */

export interface EncodeOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  /** Draws the frame for time `t` (seconds) onto `canvas`. */
  draw(t: number): void | Promise<void>;
  signal?: AbortSignal;
  onProgress?(p: number): void;
  bitrate?: number;
}

export interface EncodedVideo {
  blob: Blob;
  ext: "mp4" | "webm";
  type: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pickH264(w: number, h: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch {
      /* the next one */
    }
  }
  return null;
}

const abort = () => new DOMException("Cancelled", "AbortError");

export async function encodeVideo(o: EncodeOptions): Promise<EncodedVideo> {
  const { width: W, height: H, fps } = o;
  const N = Math.round(o.seconds * fps);
  const bitrate = o.bitrate ?? 8_000_000;
  const cfg = await pickH264(W, H, fps, bitrate);
  if (cfg) {
    let failure: unknown = null;
    let description: Uint8Array | null = null;
    const chunks: { data: Uint8Array; ts: number; dur: number; key: boolean }[] = [];
    const copy = (d: AllowSharedBufferSource) => {
      const v = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array((d as ArrayBufferView).buffer, (d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteLength);
      return v.slice();
    };
    const enc = new VideoEncoder({
      output(chunk, meta) {
        if (meta?.decoderConfig?.description && !description) description = copy(meta.decoderConfig.description);
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 1e6 / fps, key: chunk.type === "key" });
      },
      error(e) {
        failure = e;
      },
    });
    enc.configure(cfg);
    try {
      for (let i = 0; i < N; i++) {
        if (o.signal?.aborted) throw abort();
        if (failure) throw failure;
        await o.draw(i / fps);
        const frame = new VideoFrame(o.canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await sleep(2);
        o.onProgress?.((i + 1) / N);
      }
      await enc.flush();
    } finally {
      if (enc.state !== "closed") enc.close();
    }
    if (failure) throw failure;
    if (!description) throw new Error("The video encoder gave no decoder configuration");
    const mux = new Mp4Muxer({ width: W, height: H, description });
    for (const c of chunks) mux.addVideo(c.data, c.ts, c.dur, c.key);
    return { blob: new Blob([mux.finalize() as BlobPart], { type: "video/mp4" }), ext: "mp4", type: "video/mp4" };
  }

  // Without WebCodecs: record the canvas in real time.
  if (typeof MediaRecorder === "undefined" || !o.canvas.captureStream) throw new Error("This browser can't record video");
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const stream = o.canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  await o.draw(0);
  rec.start(250);
  const t0 = performance.now();
  for (;;) {
    if (o.signal?.aborted) {
      rec.stop();
      throw abort();
    }
    const t = (performance.now() - t0) / 1000;
    if (t >= o.seconds) break;
    await o.draw(t);
    o.onProgress?.(t / o.seconds);
    await new Promise((r) => requestAnimationFrame(r));
  }
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  const mp4 = mime.startsWith("video/mp4");
  return { blob: new Blob(parts, { type: mp4 ? "video/mp4" : "video/webm" }), ext: mp4 ? "mp4" : "webm", type: mp4 ? "video/mp4" : "video/webm" };
}
