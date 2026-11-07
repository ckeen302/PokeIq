"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { VIDEO_H, VIDEO_W } from "@/lib/sizes/export";
import type { Race } from "@/lib/race/race";
import type { Quality } from "./scene";
import { RACE_URLS } from "./urls";
import { videoPlan } from "./record";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number; label: string }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string; seconds: number }
  | { kind: "error"; message: string };

function videoSupport(): "mp4" | "webm" | "none" {
  if (typeof window === "undefined") return "none";
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return "mp4";
  if (typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function") return "webm";
  return "none";
}

const param = (k: string) => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };
const lengthFromUrl = () => { const n = Number(param("len")); return Number.isFinite(n) && n >= 3 && n <= 60 ? Math.round(n) : undefined; };
const fpsFromUrl = () => { const n = Number(param("vfps")); return Number.isFinite(n) && n >= 10 && n <= 60 ? Math.round(n) : undefined; };
const qualityFromUrl = (): Quality | undefined => { const q = param("vq"); return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : undefined; };

/** The public site's host, never localhost. */
const HOST = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://playpokeiq.com").host;

/**
 * "Make a video": the race as a vertical 1080 × 1920 MP4 for TikTok, Reels
 * and Shorts: the hook card, the broadcast with phone-sized graphics, the
 * photo finish and the results, then the end card with the link. Rendered
 * frame by frame on this device at the highest quality, so it's smooth
 * however slow the device is.
 */
export default function MakeRaceVideo({ race, hook, title, slug, link, onRecording, onClose }: {
  race: Race;
  hook: string;
  title: string;
  slug: string;
  link: string;
  onRecording(on: boolean): void;
  onClose(): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [support, setSupport] = useState<"mp4" | "webm" | "none">("mp4");
  const [canShare, setCanShare] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgress = useRef(0);
  const seconds = useMemo(() => (typeof window === "undefined" ? undefined : lengthFromUrl()), []);
  const length = useMemo(() => videoPlan(race, seconds).total, [race, seconds]);

  useEffect(() => setSupport(videoSupport()), []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    lastProgress.current = 0;
    setPhase({ kind: "recording", p: 0, label: "Setting the scene" });
    onRecording(true);
    try {
      const { recordRace } = await import("./record");
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
      const res = await recordRace({
        race,
        hook,
        title,
        slug,
        link: `${HOST}${link}`,
        urls: RACE_URLS,
        font,
        logo: "/logo.svg",
        seconds,
        quality: qualityFromUrl(),
        fps: fpsFromUrl(),
        signal: ac.signal,
        onProgress(p, label) {
          const now = performance.now();
          if (now - lastProgress.current < 120 && p < 1) return;
          lastProgress.current = now;
          setPhase({ kind: "recording", p, label });
        },
      });
      setPhase({ kind: "done", url: URL.createObjectURL(res.blob), blob: res.blob, name: res.name, type: res.type, seconds: res.seconds });
      track("race_video", { race: slug, distance: race.distance, format: res.type });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setPhase({ kind: "idle" });
      else setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      abortRef.current = null;
      onRecording(false);
    }
  }

  async function shareFile() {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    try {
      await navigator.share({ files: [file], title: hook, text: `${hook} #pokemon #pokeiq` });
    } catch {
      // Closed the share sheet.
    }
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="rc-video-title" data-testid="race-video-dialog">
      <motion.div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
        <button type="button" onClick={() => { abortRef.current?.abort(); onClose(); }} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="race-video-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#ffd84a]" aria-hidden />
          <h2 id="rc-video-title" className="font-display text-lg font-bold uppercase tracking-wider">Make a video</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">A vertical {VIDEO_W} × {VIDEO_H} video of this race for TikTok, Reels and Shorts, with the stadium sound.</p>
        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className="mx-auto aspect-[9/16] max-h-[52vh] rounded-lg bg-black" data-testid="race-video-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="rc-go inline-flex h-11 items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider" data-testid="race-video-download">
                <Download className="h-4 w-4" aria-hidden /> Download
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="race-video-share">
                <Share2 className="h-4 w-4" aria-hidden /> Share
              </button>
            </div>
            <p className="text-center text-xs text-white/50">{phase.name} · {phase.type === "video/mp4" ? "MP4" : "WebM"} · {phase.seconds.toFixed(1)} s</p>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white">Make another</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
              <p className="font-display font-semibold uppercase tracking-wide text-[#ffd84a]">“{hook}”</p>
              <p className="mt-1 text-white/60">{race.distance} m · about {Math.round(length)} s · {support === "webm" ? "WebM" : "MP4"}</p>
            </div>
            {phase.kind === "recording" ? (
              <div className="space-y-2" data-testid="race-video-progress" data-p={phase.p.toFixed(3)}>
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {phase.label}</span>
                  <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)} aria-label="Rendering the video">
                  <div className="h-full origin-left rounded-full bg-gradient-to-r from-[#ffd84a] to-[#ff9d00]" style={{ transform: `scaleX(${phase.p})` }} />
                </div>
                <button type="button" onClick={() => abortRef.current?.abort()} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="race-video-cancel">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={record} disabled={support === "none"} className="rc-go inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="race-video-record">
                <Clapperboard className="h-4 w-4" aria-hidden /> Record
              </button>
            )}
            {phase.kind === "error" && <p className="text-sm text-red-300" role="alert">{phase.message}</p>}
            <p className="text-xs leading-relaxed text-white/45">
              {support === "none" ? "This browser can't record video. Try Chrome, Edge or Safari." : support === "webm" ? "This browser records in real time. Chrome, Edge and Safari make an MP4 frame by frame." : "Rendered frame by frame on this device, so it stays smooth. Keep this tab open while it records."}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
