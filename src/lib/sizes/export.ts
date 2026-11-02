import { SIZES_PATH } from "./deeplink";

/**
 * "Make a video": the export settings shared by the dialog, the recorder
 * and the tests. A vertical 9:16 1080 × 1920 MP4 for TikTok, Reels and
 * Shorts: a hook title card, the glide with phone-sized labels and
 * fun-fact captions, a watermark throughout and an end card with the logo
 * and the link. Client-safe.
 */

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const VIDEO_FPS = 30;
export const VIDEO_LENGTHS = [15, 30, 60] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];
export const DEFAULT_LENGTH: VideoLength = 30;
/** Shortest export (the smoke test makes a 5 s one). */
export const MIN_SECONDS = 3;

/** The hook card shows first, then fades over the opening of the glide. */
export const HOOK_SECONDS = 2.2;
/** The end card closes the video. */
export const END_SECONDS = 2.6;

/** The end card's link: the public site (never localhost, even in development). */
export const LINK_TEXT = `${new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://pokeiq.vercel.app").host}${SIZES_PATH}`;
export const WATERMARK_TEXT = "PokéIQ";

export interface VideoSettings {
  width: number;
  height: number;
  fps: number;
  seconds: number;
  /** Video bitrate (bits/s). */
  bitrate: number;
  audioBitrate: number;
  hook: string;
  watermark: string;
  endLink: string;
}

/** The settings for a video of `seconds` with this hook title. */
export function videoSettings(seconds: number, hook: string): VideoSettings {
  const s = Math.max(MIN_SECONDS, Math.min(60, Math.round(seconds)));
  return {
    width: VIDEO_W,
    height: VIDEO_H,
    fps: VIDEO_FPS,
    seconds: s,
    bitrate: 9_000_000,
    audioBitrate: 160_000,
    hook,
    watermark: WATERMARK_TEXT,
    endLink: LINK_TEXT,
  };
}

/** Number of frames in a video. */
export const frameCount = (v: Pick<VideoSettings, "seconds" | "fps">) => Math.round(v.seconds * v.fps);

/**
 * The glide's share of the video: the camera holds on its first figure
 * under the hook card, and its final pull-back runs under the end card.
 * Short test videos shorten both cards.
 */
export function videoTimeline(seconds: number) {
  const k = Math.min(1, seconds / 15);
  const hook = HOOK_SECONDS * k;
  const end = END_SECONDS * k;
  return { hook, end, glide: seconds, intro: hook * 0.7, finale: end + 1.4 * k };
}

/** Fades for overlays (0..1) by time. */
export function cardAlpha(t: number, start: number, end: number, fade = 0.35): number {
  if (t < start || t > end) return 0;
  return Math.min(1, (t - start) / fade, (end - t) / fade);
}

/** A file name for the download: "pokeiq-sizes-legendaries-30s.mp4". */
export function videoFileName(slug: string, seconds: number, ext: "mp4" | "webm"): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lineup";
  return `pokeiq-sizes-${safe}-${seconds}s.${ext}`;
}
