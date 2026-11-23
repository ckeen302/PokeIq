import { SITE_URL } from "@/lib/site";
import { encodeVideo, type EncodedVideo } from "@/lib/video/encode";
import type { SceneApi } from "./scene";

const W = 1080;
const H = 1920;

/** A length (?len=3) and frame rate (?vfps=10) from the address, for quick checks on machines without a GPU. */
function clipParams(): { seconds: number; fps: number } {
  try {
    const q = new URLSearchParams(window.location.search);
    const len = Number(q.get("len"));
    const fps = Number(q.get("vfps"));
    return { seconds: len >= 1 && len <= 10 ? len : 6, fps: fps >= 5 && fps <= 60 ? Math.round(fps) : 30 };
  } catch {
    return { seconds: 6, fps: 30 };
  }
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A short vertical video of a region on the World Globe: the world turns
 * past it while the camera closes in, with the region's name, its
 * generation and the site's address over it. Drawn frame by frame from the
 * live scene, which is given back as it was afterwards.
 */
export async function makeGlobeClip(o: { api: SceneApi; region: string; name: string; kicker: string; signal: AbortSignal; onProgress(p: number): void }): Promise<EncodedVideo> {
  const { seconds, fps } = clipParams();
  const clip = o.api.clip(o.region, W, H);
  if (!clip) throw new Error("The globe isn't ready");
  const compose = document.createElement("canvas");
  compose.width = W;
  compose.height = H;
  const g = compose.getContext("2d")!;
  const host = new URL(SITE_URL).host;
  const bg = `hsl(${token("--background") || "240 20% 6%"})`;
  const screen = token("--screen") || "190 90% 60%";
  const display = token("--font-display") || "sans-serif";
  const pixel = token("--font-pixel") || "monospace";
  const glow = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, H * 0.6);
  glow.addColorStop(0, `hsl(${screen} / 0.16)`);
  glow.addColorStop(1, "transparent");
  const shadowed = (s: string, x: number, y: number, blur = 16) => {
    g.save();
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = blur;
    g.fillText(s, x, y);
    g.restore();
  };
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
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
        g.drawImage(clip.frame(t / seconds, t), 0, 0, W, H);
        const a = Math.max(0, Math.min(1, (t - 0.4) / 0.6));
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.globalAlpha = a;
        g.fillStyle = `hsl(${screen})`;
        g.font = `400 ${W * 0.026}px ${pixel}`;
        shadowed(o.kicker.toUpperCase(), W / 2, H * 0.1);
        g.fillStyle = "#ffffff";
        g.font = `700 ${W * 0.1}px ${display}`;
        shadowed(o.name.toUpperCase(), W / 2, H * 0.145, 22);
        g.globalAlpha = 1;
        g.fillStyle = "rgba(220,240,255,0.8)";
        g.font = `600 ${W * 0.03}px ${display}`;
        shadowed(`${host}/pokeguessr/globe`, W / 2, H * 0.955);
      },
    });
  } finally {
    clip.end();
  }
}
