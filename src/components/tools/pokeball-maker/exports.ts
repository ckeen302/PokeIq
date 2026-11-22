import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { saveBlob } from "@/lib/shiny-maker/export";
import { SITE_URL } from "@/lib/site";
import { encodeVideo } from "@/lib/video/encode";
import type { Design } from "@/lib/pokeball-maker/design";
import { idlePose, VIDEO_SECONDS, videoPose, type Pose } from "@/lib/pokeball-maker/anim";
import { printParts, stlBytes } from "@/lib/pokeball-maker/geometry";
import type { BallScene } from "./scene";

/**
 * The downloads, all made in the browser: a transparent PNG, a GIF of the ball turning, a vertical video of it
 * opening and being caught, a GLB model and an STL to print.
 */

export { saveBlob };

export function fileBase(d: Design): string {
  const s = (d.name || "poke-ball").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "poke-ball";
}

/** The pose for a still picture: three-quarters on, the button towards you. */
export const STILL_POSE: Pose = { ...idlePose(0), yaw: -0.42, tilt: 0.16, y: 0 };

export async function png(scene: BallScene, d: Design, scale: 1 | 2 | 4) {
  const blob = await scene.still(800 * scale, STILL_POSE);
  saveBlob(blob, `${fileBase(d)}${scale > 1 ? `@${scale}x` : ""}.png`);
}

/** One full turn, looping seamlessly, on the stage's backdrop (a GIF can't hold soft transparency). */
export async function gif(scene: BallScene, d: Design) {
  const S = 480, N = 48;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  const frames: Uint8ClampedArray[] = [];
  try {
    for (let i = 0; i < N; i++) {
      const k = i / N;
      const pose: Pose = { ...idlePose(0), yaw: k * Math.PI * 2 - 0.42, y: Math.sin(k * Math.PI * 2) * 0.9, tilt: 0.12 };
      g.drawImage(scene.exportFrame(pose, S, S, k * 2.4), 0, 0, S, S);
      frames.push(g.getImageData(0, 0, S, S).data);
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    scene.endExport();
  }
  // One palette for the whole loop (from a sample of every frame), so colours don't flicker between frames.
  const sample = new Uint8ClampedArray((S * S * 4 * N) / 16);
  let o = 0;
  for (const f of frames)
    for (let p = 0; p < f.length && o < sample.length; p += 64) {
      sample.set(f.subarray(p, p + 4), o);
      o += 4;
    }
  const palette = quantize(sample, 256, { format: "rgb565" });
  const enc = GIFEncoder();
  frames.forEach((f, i) => {
    enc.writeFrame(applyPalette(f, palette, "rgb565"), S, S, { palette: i === 0 ? palette : undefined, delay: 50, repeat: 0, first: i === 0 });
  });
  enc.finish();
  saveBlob(new Blob([enc.bytes() as BlobPart], { type: "image/gif" }), `${fileBase(d)}.gif`);
}

export interface VideoText {
  title: string;
  kicker: string;
  end: string;
  font: string;
  sans: string;
}

/** The vertical video: the ball turns, opens (its effect, its Pokémon), is caught, then an end card. */
export async function video(scene: BallScene, d: Design, text: VideoText, onProgress: (p: number) => void, signal: AbortSignal) {
  const W = 1080, H = 1920, fps = 30;
  const compose = document.createElement("canvas");
  compose.width = W;
  compose.height = H;
  const g = compose.getContext("2d")!;
  const host = new URL(SITE_URL).host;
  const withMon = d.inside.id > 0;
  const fade = (t: number, a: number, b: number, s = 0.4) => Math.max(0, Math.min(1, (t - a) / s, (b - t) / s));
  const shadow = (s: string, x: number, y: number, blur = 14) => {
    g.save();
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = blur;
    g.fillText(s, x, y);
    g.restore();
  };
  try {
    const out = await encodeVideo({
      canvas: compose,
      width: W,
      height: H,
      fps,
      seconds: VIDEO_SECONDS,
      signal,
      onProgress,
      draw(t) {
        g.drawImage(scene.exportFrame(videoPose(t, withMon), W, H, t), 0, 0, W, H);
        g.textAlign = "center";
        g.textBaseline = "middle";
        // The name at the top, then the end card.
        const a = fade(t, 0.2, VIDEO_SECONDS - 1.1);
        if (a > 0) {
          g.globalAlpha = a;
          g.fillStyle = "rgba(255,255,255,0.7)";
          g.font = `600 ${W * 0.03}px ${text.sans}`;
          shadow(text.kicker.toUpperCase(), W / 2, H * 0.1);
          g.fillStyle = "#ffffff";
          g.font = `700 ${W * 0.075}px ${text.font}`;
          shadow(text.title, W / 2, H * 0.145, 20);
          g.globalAlpha = 1;
        }
        const e = fade(t, VIDEO_SECONDS - 1.0, VIDEO_SECONDS + 1);
        if (e > 0) {
          g.globalAlpha = e;
          g.fillStyle = "rgba(8,6,16,0.66)";
          g.fillRect(0, 0, W, H);
          g.fillStyle = "#ffffff";
          g.font = `700 ${W * 0.08}px ${text.font}`;
          shadow(text.end, W / 2, H * 0.46, 20);
          g.fillStyle = "#cfe0ff";
          g.font = `500 ${W * 0.036}px ${text.sans}`;
          shadow(`${host}/tools/pokeball-maker`, W / 2, H * 0.53);
          g.globalAlpha = 1;
        }
      },
    });
    saveBlob(out.blob, `${fileBase(d)}.${out.ext}`);
  } finally {
    scene.endExport();
  }
}

export async function glb(scene: BallScene, d: Design) {
  saveBlob(await scene.glb(), `${fileBase(d)}.glb`);
}

export function stl(d: Design) {
  const bytes = stlBytes(printParts(d).map((p) => p.solid));
  saveBlob(new Blob([bytes as BlobPart], { type: "model/stl" }), `${fileBase(d)}.stl`);
}
