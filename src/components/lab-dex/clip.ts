import { SITE_URL } from "@/lib/site";
import { encodeVideo, type EncodedVideo } from "@/lib/video/encode";
import type { LabScene, WheelState } from "./scene";

/** The clip: vertical, the size every video on the site is made at. */
export const CLIP_W = 1080;
export const CLIP_H = 1920;
export const CLIP_SECONDS = 6;
export const CLIP_FPS = 30;

export interface ClipText {
  /** "#0025". */
  no: string;
  name: string;
  /** The types, as the page writes them ("Electric", "Grass · Poison"). */
  types: string;
  /** The type's colour, for the line under the name. */
  color: string;
  display: string;
  pixel: string;
}

/** A length (?len=3) and frame rate (?vfps=10) from the address, for quick checks on machines without a GPU. */
export function clipParams(): { seconds: number; fps: number } {
  try {
    const q = new URLSearchParams(window.location.search);
    const len = Number(q.get("len"));
    const fps = Number(q.get("vfps"));
    return { seconds: len >= 1 && len <= 10 ? len : CLIP_SECONDS, fps: fps >= 5 && fps <= 60 ? Math.round(fps) : CLIP_FPS };
  } catch {
    return { seconds: CLIP_SECONDS, fps: CLIP_FPS };
  }
}

/**
 * A short video of the Pokémon on the holo-table: it's scanned in under its
 * line of light, then turns slowly in the type-coloured lab, with its
 * number, name and types over it and the site's address at the bottom.
 * Drawn frame by frame from the live scene (no second WebGL context),
 * which is switched to the video's size meanwhile and given back after.
 */
export async function makeLabClip(o: { scene: LabScene; slot: number; text: ClipText; signal: AbortSignal; onProgress(p: number): void }): Promise<EncodedVideo> {
  const { scene, text } = o;
  const { seconds, fps } = clipParams();
  const W = CLIP_W, H = CLIP_H;
  const compose = document.createElement("canvas");
  compose.width = W;
  compose.height = H;
  const g = compose.getContext("2d")!;
  const host = new URL(SITE_URL).host;
  const wheel: WheelState = { p: o.slot, v: 0, target: o.slot, dragging: false };
  const t0 = performance.now() / 1000;
  const fade = (t: number, a: number, s = 0.5) => Math.max(0, Math.min(1, (t - a) / s));
  const shadowed = (s: string, x: number, y: number, blur = 16) => {
    g.save();
    g.shadowColor = "rgba(0,0,0,0.85)";
    g.shadowBlur = blur;
    g.fillText(s, x, y);
    g.restore();
  };
  scene.exportSize({ w: W, h: H });
  scene.rescan();
  try {
    return await encodeVideo({
      canvas: compose,
      width: W,
      height: H,
      fps,
      seconds,
      signal: o.signal,
      onProgress: o.onProgress,
      bitrate: 10_000_000,
      draw(t) {
        scene.frame(wheel, 1 / fps, t0 + t);
        // Read straight after the frame is drawn, while its buffer still holds it.
        g.drawImage(scene.canvas, 0, 0, W, H);
        g.textAlign = "center";
        g.textBaseline = "middle";
        const a = fade(t, 0.9);
        if (a > 0) {
          g.globalAlpha = a;
          g.fillStyle = "rgba(255,255,255,0.75)";
          g.font = `400 ${W * 0.026}px ${text.pixel}`;
          shadowed(text.no, W / 2, H * 0.085);
          g.fillStyle = "#ffffff";
          g.font = `700 ${W * 0.085}px ${text.display}`;
          shadowed(text.name.toUpperCase(), W / 2, H * 0.125, 22);
          g.fillStyle = text.color;
          g.font = `600 ${W * 0.034}px ${text.display}`;
          shadowed(text.types.toUpperCase(), W / 2, H * 0.165);
          g.globalAlpha = 1;
        }
        g.fillStyle = "rgba(220,240,255,0.8)";
        g.font = `600 ${W * 0.03}px ${text.display}`;
        shadowed(`${host}/lab/pokedex`, W / 2, H * 0.955);
      },
    });
  } finally {
    scene.exportSize(null);
  }
}
