/**
 * Cuts, loops and encodes a recorded take for the home page's hero.
 *
 *   node scripts/hero-videos/encode.mjs <take> <out-name> [--from=mark|frame] [--to=mark|frame] [--fade=0.6] [--crf=26]
 *
 * <take> is a folder of frames from lib.mjs (with meta.json). The clip runs
 * from..to, its last `fade` seconds crossfading into its own start, so it
 * loops softly. Writes public/home/clips/<out-name>.mp4 (H.264, no audio
 * track, faststart), <out-name>.av1.mp4 (AV1, smaller, for browsers that
 * play it) and <out-name>.webp (its first frame: the poster).
 * Desktop takes come out 1600×900, phone takes 800×1000 (4:5).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { OUT_ROOT } from "./lib.mjs";

export function encode(take, name, { from = 0, to, fade = 0.6, crf, maxBytes, minBytes, size, maxSeconds = 9.6 } = {}) {
  const dir = path.isAbsolute(take) ? take : path.join(OUT_ROOT, take);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const at = (v, dflt) => (v === undefined ? dflt : typeof v === "number" ? v : meta.marks[v] ?? Number(v));
  const fps = meta.fps;
  const a = at(from, 0);
  // At most maxSeconds once looped (the fade overlaps the start).
  const b = Math.min(at(to, meta.frames), a + Math.round((maxSeconds + fade) * meta.fps));
  const fadeN = Math.round(fade * fps);
  const [w, h] = size ?? (meta.phone ? [800, 1000] : [1600, 900]);
  const outDir = path.resolve("public/home/clips");
  fs.mkdirSync(outDir, { recursive: true });
  const mp4 = path.join(outDir, `${name}.mp4`);
  const poster = path.join(outDir, `${name}.webp`);
  // The body is frames a+fadeN .. b-1; its last fadeN frames blend into frames a .. a+fadeN-1,
  // so the clip's last frame leads straight into its first.
  const body = b - a - fadeN;
  if (body <= fadeN) throw new Error(`clip too short: ${b - a} frames`);
  // Frames are the whole viewport at device scale: crop to the take's clip.
  const c = meta.clip;
  const d = meta.dpr ?? 2;
  const crop = `crop=${Math.round(c.width * d)}:${Math.round(c.height * d)}:${Math.round(c.x * d)}:${Math.round(c.y * d)}`;
  const scale = `${crop},scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1`;
  const filter = fadeN
    ? `[0:v]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS,split[x][y];` +
      `[x]trim=start_frame=${fadeN},setpts=PTS-STARTPTS[main];` +
      `[y]trim=end_frame=${fadeN},setpts=PTS-STARTPTS[head];` +
      `[main][head]xfade=transition=fade:duration=${fade}:offset=${(body - fadeN) / fps + fadeN / fps - fade},${scale},format=yuv420p[v]`
    : `[0:v]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS,${scale},format=yuv420p[v]`;
  const run = (q) => {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-framerate", String(fps),
        "-i", path.join(dir, "f%05d.jpg"),
        "-filter_complex", filter,
        "-map", "[v]",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryslow",
        "-tune", "animation",
        "-crf", String(q),
        "-profile:v", "high",
        "-level", "4.2",
        "-pix_fmt", "yuv420p",
        "-g", String(fps * 2),
        "-x264-params", "aq-mode=3",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-movflags", "+faststart",
        mp4,
      ],
      { stdio: "inherit" }
    );
    return fs.statSync(mp4).size;
  };
  // Aim for the size budget: start at crf and step until it fits.
  let q = crf ?? (meta.phone ? 24 : 23);
  let bytes = run(q);
  const max = maxBytes ?? (meta.phone ? 1_000_000 : 1_450_000);
  const min = minBytes ?? (meta.phone ? 550_000 : 950_000);
  for (let i = 0; i < 8 && bytes > max; i++) bytes = run(++q);
  for (let i = 0; i < 4 && bytes < min && q > 18; i++) {
    const before = q;
    const prev = bytes;
    bytes = run(--q);
    if (bytes > max) {
      bytes = run(before);
      q = before;
      break;
    }
    if (bytes === prev) break;
  }
  // AV1 too (smaller, and what browsers without H.264 play), from the H.264 cut's exact frames' source.
  const av1 = path.join(outDir, `${name}.av1.mp4`);
  const runAv1 = (q) => {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-framerate", String(fps),
        "-i", path.join(dir, "f%05d.jpg"),
        "-filter_complex", filter,
        "-map", "[v]",
        "-an",
        "-c:v", "libsvtav1",
        "-preset", "4",
        "-crf", String(q),
        "-g", String(fps * 2),
        "-pix_fmt", "yuv420p",
        "-svtav1-params", "tune=0",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-movflags", "+faststart",
        av1,
      ],
      { stdio: "inherit" }
    );
    return fs.statSync(av1).size;
  };
  // About two thirds of the H.264 file.
  let qa = meta.phone ? 36 : 34;
  let av1Bytes = runAv1(qa);
  for (let i = 0; i < 6 && av1Bytes > bytes * 0.75; i++) av1Bytes = runAv1((qa += 2));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", poster], { stdio: "inherit" });
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" }).trim());
  const info = { name, crf: q, bytes, av1Crf: qa, av1Bytes, poster: fs.statSync(poster).size, duration: dur, width: w, height: h };
  console.log(JSON.stringify(info));
  return info;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [take, name, ...rest] = process.argv.slice(2);
  const opts = Object.fromEntries(rest.map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, /^[\d.]+$/.test(v) ? Number(v) : v]));
  encode(take, name, opts);
}
