import { VIDEO_FPS, VIDEO_H, VIDEO_W } from "@/lib/sizes/export";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { GROUNDED } from "@/lib/race/gait";
import { motionAt } from "@/lib/race/model";
import { excitementAt, photoWindow, planShow, raceTimeAt, shotAt, shotProgress, type ShowPlan } from "@/lib/race/broadcast";
import { cameraFor } from "@/lib/race/director";
import { displayTimes, formatTime, leaderAt, spotsAt, type Race } from "@/lib/race/race";
import { createRaceScene, type Quality, type SceneUrls } from "./scene";
import { APPLAUSE_URL, CROWD_URL, noiseBuffer, scheduleBeep, scheduleGun, scheduleThud, stadiumImpulse } from "./audio";
import { drawClockBug, drawFastForward, drawLaneIntro, drawNameTags, drawPhotoFinish, drawReplayBug, drawResults, drawStartCall, gameText } from "./graphics";

/**
 * "Make a video" for a race: the whole broadcast at 1080 × 1920, frame by
 * frame at the scene's export quality, with phone-sized graphics, a hook
 * card, the photo finish, the results, a small watermark and an end card
 * with the link. Encoded with WebCodecs (H.264, and AAC or Opus for the
 * stadium sound mixed offline) and packed by the Sizes MP4 muxer; without
 * WebCodecs the page records a WebM in real time with MediaRecorder.
 */

export interface RaceRecordOptions {
  race: Race;
  hook: string;
  title: string;
  slug: string;
  /** The end card's link (host and path, no scheme). */
  link: string;
  urls: SceneUrls;
  font: string;
  logo: string;
  /** Force a length (tests): the start of a quick broadcast, then the end card. */
  seconds?: number;
  quality?: Quality;
  fps?: number;
  onProgress(p: number, label: string): void;
  signal: AbortSignal;
}

export interface RaceRecordResult {
  blob: Blob;
  name: string;
  type: string;
  seconds: number;
}

export const HOOK_SECONDS = 2.2;
export const END_SECONDS = 2.6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The video's timeline: the broadcast, then the end card. */
export function videoPlan(race: Race, seconds?: number): { plan: ShowPlan; total: number; end: number } {
  const plan = planShow(race, { video: true, quick: seconds != null && seconds < 12 });
  if (seconds != null) return { plan, total: seconds, end: Math.max(seconds * 0.6, seconds - 1.6) };
  const total = Math.ceil((plan.end + END_SECONDS) * 10) / 10;
  return { plan, total, end: plan.end };
}

export function raceVideoName(slug: string, distance: number, ext: "mp4" | "webm"): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "race";
  return `pokeiq-race-${safe}-${distance}m.${ext}`;
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

/** The stadium sound, mixed offline: the crowd following the excitement, the gun, heavy footfalls, the finish's applause, the timing beep. */
async function mixAudio(race: Race, plan: ShowPlan, seconds: number, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    const get = async (url: string) => { const r = await fetch(url, { signal }); return ctx.decodeAudioData(await r.arrayBuffer()); };
    const [crowd, applause] = await Promise.all([get(CROWD_URL).catch(() => null), get(APPLAUSE_URL).catch(() => null)]);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const verb = ctx.createConvolver();
    verb.buffer = stadiumImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(verb).connect(master);
    const noise = noiseBuffer(ctx, 3);
    // Crowd bed and roar, following the excitement curve.
    const crowdGain = ctx.createGain(), roarGain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    if (crowd) {
      const src = ctx.createBufferSource();
      src.buffer = crowd;
      src.loop = true;
      src.connect(lp).connect(crowdGain);
      src.start(0, Math.random() * Math.max(0, crowd.duration - 1));
    }
    const roar = ctx.createBufferSource();
    roar.buffer = noise;
    roar.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    roar.connect(bp).connect(roarGain);
    roar.start(0);
    for (const g of [crowdGain, roarGain]) { g.connect(master); g.connect(wet); }
    crowdGain.gain.setValueAtTime(0, 0);
    roarGain.gain.setValueAtTime(0, 0);
    for (let t = 0; t <= seconds; t += 0.1) {
      const e = excitementAt(plan, race, Math.min(t, plan.end - 0.01));
      const fade = Math.min(1, t / 0.6, Math.max(0, (seconds - t) / 0.8));
      crowdGain.gain.linearRampToValueAtTime((0.22 + 0.55 * e) * fade, t);
      roarGain.gain.linearRampToValueAtTime((0.02 + 0.24 * e * e) * fade, t);
      lp.frequency.linearRampToValueAtTime(1300 + 2600 * e, t);
    }
    // The gun.
    if (plan.gun < seconds) { scheduleGun(ctx, master, plan.gun, noise, 0.8); scheduleGun(ctx, wet, plan.gun, noise, 1.2); }
    // Applause as the winner crosses (live, not in the replay).
    if (applause) {
      for (const s of plan.shots) {
        if (s.phase !== "race" && s.phase !== "fast") continue;
        const r1 = s.race0 + (s.t1 - s.t0) * s.rate;
        if (race.first >= s.race0 && race.first <= r1) {
          const at = s.t0 + (race.first - s.race0) / Math.max(1e-6, s.rate);
          if (at < seconds) {
            const src = ctx.createBufferSource();
            src.buffer = applause;
            const g = ctx.createGain();
            g.gain.value = 0.6;
            src.connect(g);
            g.connect(master);
            g.connect(wet);
            src.start(at);
          }
          break;
        }
      }
    }
    // Heavy footfalls in the live shots.
    const heavy = race.lanes.filter((r) => r.entrant.kg >= 150 && GROUNDED.has(r.entrant.motion));
    if (heavy.length) {
      let lastPhase = new Map(heavy.map((r) => [r.lane, 0]));
      for (let t = plan.gun; t < Math.min(seconds, plan.end); t += 1 / 120) {
        const s = shotAt(plan, t);
        if (s.phase !== "race") { lastPhase = new Map(heavy.map((r) => [r.lane, Math.floor(motionAt(r.profile, raceTimeAt(plan, t)).phase)])); continue; }
        const rt = raceTimeAt(plan, t);
        for (const r of heavy) {
          const m = motionAt(r.profile, rt);
          const ph = Math.floor(m.phase);
          if (ph !== lastPhase.get(r.lane) && m.v > 0.2) scheduleThud(ctx, master, t, noise, Math.min(0.7, 0.3 * Math.sqrt(r.entrant.kg / 400)), Math.max(0.55, 1.4 - r.entrant.kg / 1500));
          lastPhase.set(r.lane, ph);
        }
      }
    }
    const photo = plan.shots.find((s) => s.phase === "photo");
    if (photo && photo.t0 < seconds) scheduleBeep(ctx, master, photo.t0 + 0.1);
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

/** Every graphic of one video frame over the scene. */
function drawFrame(g: CanvasRenderingContext2D, W: number, H: number, t: number, race: Race, plan: ShowPlan, total: number, end: number, o: { font: string; hook: string; title: string; link: string; logo: HTMLImageElement | null; photo: HTMLCanvasElement | null; heads: { lane: number; x: number; y: number; by: number; visible: boolean }[]; times: Map<import("@/lib/race/race").RaceLane, string> }) {
  const font = o.font;
  const gfx = { font, scale: 1.75 };
  const top = H * 0.15, bottom = H * 0.2;
  const inShow = t < end;
  const shot = shotAt(plan, t);
  const k = shotProgress(shot, t);
  const raceT = raceTimeAt(plan, t);
  const winPhoto = photoWindow(race);
  if (inShow) {
    if (shot.phase === "intro" && shot.lane != null) {
      const r = race.lanes.find((x) => x.lane === shot.lane);
      if (r) drawLaneIntro(g, W, H, r, k, { ...gfx, scale: 1.55, bottom: bottom + 40 });
    } else if (shot.phase === "marks" || shot.phase === "set") {
      drawStartCall(g, W, H, shot.phase === "marks" ? "ON YOUR MARKS" : "SET", k, gfx);
    } else if (shot.phase === "race" || shot.phase === "fast") {
      const lead = leaderAt(race, raceT);
      const v = spotsAt(race, raceT).find((x) => x.lane === lead.lane)?.v ?? 0;
      drawClockBug(g, W, H, { ...gfx, scale: 1.6, top, title: `${race.distance} m · ${o.title}`, time: formatTime(Math.min(raceT, race.first)), leader: raceT < race.first ? { name: lead.entrant.name, v } : null, live: raceT < race.first });
      if (shot.phase === "fast") {
        const r = race.lanes.find((x) => x.lane === shot.lane);
        drawFastForward(g, W, H, shot.rate, r ? (raceT > race.first ? `Meanwhile, ${r.entrant.name}…` : `${r.entrant.name} leads`) : "", { ...gfx, scale: 1.4, top: top + 150 });
      }
      const heads = o.heads.filter((a) => a.visible && a.by - a.y > 30);
      drawNameTags(g, heads.map((a) => ({ lane: a.lane, name: race.lanes.find((x) => x.lane === a.lane)!.entrant.name, x: a.x, y: a.y, lead: a.lane === lead.lane })), { font, scale: 1.7 });
      if (raceT >= race.first && raceT < race.first + 3) {
        const w = race.order[0];
        drawStartCall(g, W, H, `${w.entrant.name.toUpperCase()} ${formatTime(w.time)}`, 0.5, { font, scale: 1.3 });
      }
    } else if (shot.phase === "replay") {
      drawReplayBug(g, W, H, { ...gfx, top });
    } else if (shot.phase === "photo" && o.photo) {
      drawPhotoFinish(g, W, H, o.photo, race, winPhoto, k, { font, scale: 1.9, top: top + 40, bottom });
    } else if (shot.phase === "results") {
      drawResults(g, W, H, race, o.times, `Results · ${race.distance} m`, k, { font, scale: 1.75, top: top + 30, bottom });
    }
  }
  // Watermark.
  g.save();
  g.globalAlpha = 0.62;
  const wm = W * 0.034;
  const wx = W * 0.05, wy = H * 0.125;
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
    const grad = g.createLinearGradient(0, H * 0.12, 0, H * 0.46);
    grad.addColorStop(0, "rgba(8,14,32,0)");
    grad.addColorStop(0.25, "rgba(8,14,32,0.74)");
    grad.addColorStop(0.75, "rgba(8,14,32,0.74)");
    grad.addColorStop(1, "rgba(8,14,32,0)");
    g.fillStyle = grad;
    g.fillRect(0, H * 0.12, W, H * 0.34);
    g.font = `800 ${W * 0.085}px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lines = wrap(g, o.hook.replace(/ (\p{Extended_Pictographic}+)$/u, " $1"), W * 0.86);
    const lh = W * 0.1;
    const y0 = H * 0.28 - ((lines.length - 1) * lh) / 2;
    const fill = g.createLinearGradient(0, y0 - lh, 0, y0 + lines.length * lh);
    fill.addColorStop(0, "#fff27a");
    fill.addColorStop(1, "#ffb000");
    lines.forEach((l, i) => gameText(g, l, W / 2, y0 + i * lh, W * 0.085, font, fill, "#0d1626", W * 0.085 * 0.2));
    gameText(g, `${race.distance} M · BASED ON THEIR STATS`, W / 2, y0 + lines.length * lh + W * 0.01, W * 0.034, font, "#9fd8ff", "#0d1626", W * 0.034 * 0.2);
    g.restore();
  }
  // End card.
  if (t >= end) {
    const a = Math.min(1, (t - end) / 0.45);
    g.save();
    g.globalAlpha = a;
    g.fillStyle = "rgba(8,12,26,0.8)";
    g.fillRect(0, 0, W, H);
    const s = W * 0.26;
    if (o.logo) g.drawImage(o.logo, W / 2 - s / 2, H * 0.34 - s / 2, s, s);
    g.textAlign = "center";
    g.textBaseline = "middle";
    gameText(g, "PokéIQ", W / 2, H * 0.34 + s * 0.72, W * 0.11, font, "#ffffff", "#0d1626", W * 0.022);
    gameText(g, "Race any Pokémon", W / 2, H * 0.52, W * 0.05, font, "#ffd21f", "#0d1626", W * 0.01);
    g.font = `800 ${W * 0.04}px ${font}`;
    const lines = wrap(g, o.link, W * 0.86);
    lines.forEach((l, i) => gameText(g, l, W / 2, H * 0.58 + i * W * 0.05, W * 0.04, font, "#9fd8ff", "#0d1626", W * 0.008));
    g.restore();
  }
}

export async function recordRace(o: RaceRecordOptions): Promise<RaceRecordResult> {
  const W = VIDEO_W, H = VIDEO_H, fps = o.fps ?? VIDEO_FPS;
  const { plan, total, end } = videoPlan(o.race, o.seconds);
  const N = Math.round(total * fps);
  o.onProgress(0, "Setting the scene");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const scene = createRaceScene(host, { quality: o.quality ?? "export", size: { w: W, h: H }, urls: o.urls, font: o.font });
  try {
    await scene.ready;
    await scene.setRace(o.race, o.signal, (k) => o.onProgress(0.02 * k, "Runners warming up"));
    // The photo finish, developed up front.
    const win = photoWindow(o.race);
    const pf = scene.photoFinish(win.from, win.to);
    for (let i = 0; i < 2000 && !pf.step(); i++) await sleep(0);
    const photo = pf.result();
    const starts = spotsAt(o.race, 0);
    const times = displayTimes(o.race);
    const compose = document.createElement("canvas");
    compose.width = W;
    compose.height = H;
    const g = compose.getContext("2d")!;
    const logo = await loadImage(o.logo);
    const drawAt = (i: number) => {
      const t = i / fps;
      const st = Math.min(t, plan.end);
      const shot = shotAt(plan, st);
      const raceT = raceTimeAt(plan, st);
      const spots = spotsAt(o.race, raceT);
      const ctx = { distance: o.race.distance, aspect: W / H, lane: shot.lane, starts };
      const pose = cameraFor(st >= plan.end ? "results" : shot.camera, shotProgress(shot, st), spots, ctx);
      const lead = leaderAt(o.race, raceT);
      scene.frame({
        raceT,
        showT: t,
        pose,
        pre: shot.phase === "marks" ? "marks" : shot.phase === "set" ? "set" : raceT > 0 ? "race" : "idle",
        excitement: excitementAt(plan, o.race, Math.min(st, plan.end - 0.01)),
        clock: raceT <= 0 ? "0.00" : formatTime(Math.min(raceT, o.race.first)),
        replay: shot.phase === "replay" ? 1 : 0,
        screen: raceT > 0 ? cameraFor("chase", 0.5, spots, { ...ctx, aspect: 16 / 9, lane: lead.lane }) : null,
      });
      g.drawImage(scene.canvas, 0, 0, W, H);
      drawFrame(g, W, H, t, o.race, plan, total, end, { font: o.font, hook: o.hook, title: o.title, link: o.link, logo, photo, heads: scene.heads(), times });
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
      o.onProgress(0.03, "Mixing the stadium sound");
      const rate = 48000;
      const acodec = await pickAudioCodec(rate);
      const mix = acodec ? await mixAudio(o.race, plan, total, rate, o.signal) : null;
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
        drawAt(i);
        const frame = new VideoFrame(compose, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await sleep(2);
        if (i % 2 === 0) await sleep(0);
        o.onProgress(0.05 + 0.95 * ((i + 1) / N), "Rendering");
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
      return { blob: new Blob([file as BlobPart], { type: "video/mp4" }), name: raceVideoName(o.slug, o.race.distance, "mp4"), type: "video/mp4", seconds: total };
    }

    // Fallback: MediaRecorder in real time.
    if (typeof MediaRecorder === "undefined" || !compose.captureStream) throw new Error("This browser can't record video");
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const isMp4 = mime.startsWith("video/mp4");
    const stream = compose.captureStream(fps);
    let actx: AudioContext | null = null;
    const mix = await mixAudio(o.race, plan, total, 48000, o.signal);
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
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250);
    const t0 = performance.now();
    for (;;) {
      if (o.signal.aborted) { rec.stop(); throw new DOMException("Cancelled", "AbortError"); }
      const t = (performance.now() - t0) / 1000;
      if (t >= total) break;
      drawAt(Math.floor(t * fps));
      o.onProgress(t / total, "Recording");
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await done;
    void actx?.close();
    return { blob: new Blob(parts, { type: isMp4 ? "video/mp4" : "video/webm" }), name: raceVideoName(o.slug, o.race.distance, isMp4 ? "mp4" : "webm"), type: isMp4 ? "video/mp4" : "video/webm", seconds: total };
  } finally {
    scene.dispose();
    host.remove();
  }
}
