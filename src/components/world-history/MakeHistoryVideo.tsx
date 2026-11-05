"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { CHAPTERS } from "@/lib/world-history/data";
import { STORY_SECONDS, chapterVideoPlan, storyVideoPlan, type Film } from "@/lib/world-history/timing";
import type { Quality } from "./scene";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number; label: string }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string; seconds: number }
  | { kind: "error"; message: string };

/** What this browser can make: an MP4 frame by frame (WebCodecs), a WebM in real time (MediaRecorder), or nothing. */
function videoSupport(): "mp4" | "webm" | "none" {
  if (typeof window === "undefined") return "none";
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return "mp4";
  if (typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function") return "webm";
  return "none";
}

const param = (k: string) => {
  try {
    return new URLSearchParams(window.location.search).get(k);
  } catch {
    return null;
  }
};
/** ?len=5: a short chapter video, or (20 s and up) a shorter story (automated checks, samples). */
const lengthFromUrl = () => { const n = Number(param("len")); return Number.isFinite(n) && n >= 3 && n <= 60 ? n : null; };
/** ?vfps=10 and ?vq=draft: a quicker render (automated checks). */
const fpsFromUrl = () => { const n = Number(param("vfps")); return Number.isFinite(n) && n >= 10 && n <= 60 ? Math.round(n) : undefined; };
const qualityFromUrl = (): Quality | undefined => { const q = param("vq"); return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : undefined; };

/**
 * "Make a video": the entire history in 60 seconds, or one chapter, as a
 * vertical 1080 × 1920 MP4 with the film's music and its captions and
 * sources. It renders frame by frame at a higher quality than the live
 * view (so it's smooth however slow the computer), shows its progress and
 * can be cancelled; then download it or share the file to an app.
 */
export default function MakeHistoryVideo({ film, chapter, onRecording, onClose }: { film: Film; chapter: number; onRecording(on: boolean): void; onClose(): void }) {
  const [len] = useState<number | null>(() => lengthFromUrl());
  const [kind, setKind] = useState<"story" | "chapter">(() => (len !== null && len < 20 ? "chapter" : "story"));
  const [pick, setPick] = useState(() => Math.max(0, chapter));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [support, setSupport] = useState<"mp4" | "webm" | "none">("mp4");
  const [canShare, setCanShare] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgress = useRef(0);

  useEffect(() => setSupport(videoSupport()), []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  const plan = useMemo(() => (kind === "story" ? storyVideoPlan(film, len !== null && len >= 20 ? len : STORY_SECONDS) : chapterVideoPlan(film, pick, len ?? 59)), [kind, film, pick, len]);
  const c = CHAPTERS[pick];
  const busy = phase.kind === "recording";

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    lastProgress.current = 0;
    setPhase({ kind: "recording", p: 0, label: "Setting the scene" });
    onRecording(true);
    try {
      const { recordHistoryVideo } = await import("./record");
      const root = document.querySelector<HTMLElement>("[data-testid='wh-stage']") ?? document.documentElement;
      const serif = getComputedStyle(root).getPropertyValue("--font-wh-serif").trim() || "Georgia, serif";
      const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      await Promise.all([document.fonts?.load(`italic 500 60px ${serif}`), document.fonts?.load(`600 40px ${serif}`), document.fonts?.load(`600 30px ${sans}`)].map((p) => p?.catch(() => undefined)));
      const res = await recordHistoryVideo({
        film,
        plan,
        hook: kind === "story" ? `The entire history of the Pokémon world in ${Math.round(plan.seconds)} seconds` : c.title,
        kicker: kind === "story" ? "From the games' own words" : `${c.numeral} · ${c.region} · ${c.when}`,
        slug: kind === "story" ? "story" : c.id,
        serif,
        sans,
        logo: "/logo.svg",
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
      setPhase({ kind: "done", url: URL.createObjectURL(res.blob), blob: res.blob, name: res.name, type: res.type, seconds: plan.seconds });
      track("history_video", { kind, chapter: kind === "chapter" ? c.id : "story", format: res.type });
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
      await navigator.share({ files: [file], title: "The History of the Pokémon World", text: "The history of the Pokémon world, from the games' own words #pokemon #pokeiq" });
      track("history_video_share", { kind });
    } catch {
      // Closed the share sheet.
    }
  }

  const tile = "rounded-md border px-3 py-2.5 text-left transition-colors";

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="wh-video-title" data-testid="wh-video-dialog">
      <motion.div
        className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0c0a18] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <button type="button" onClick={() => { abortRef.current?.abort(); onClose(); }} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="wh-video-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#f2c96b]" aria-hidden />
          <h2 id="wh-video-title" className="font-display text-lg font-bold uppercase tracking-wider">Make a video</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">A vertical 1080 × 1920 video for TikTok, Reels and Shorts, with music, captions and sources.</p>

        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className="mx-auto aspect-[9/16] max-h-[52vh] rounded-lg bg-black" data-testid="wh-video-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="wh-play h-11 justify-center text-sm" data-testid="wh-video-download" onClick={() => track("history_video_download", { kind })}>
                <Download className="h-4 w-4" aria-hidden /> Download
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="wh-video-share" title={canShare ? undefined : "Sharing files isn't available in this browser: download it instead"}>
                <Share2 className="h-4 w-4" aria-hidden /> Share
              </button>
            </div>
            <p className="text-center text-xs text-white/50" data-testid="wh-video-file">{phase.name} · {phase.type === "video/mp4" ? "MP4" : "WebM"} · {Math.round(phase.seconds)} s</p>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white">Make another</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-2" role="radiogroup" aria-label="What to film">
              <button type="button" role="radio" aria-checked={kind === "story"} disabled={busy} onClick={() => setKind("story")} className={cn(tile, kind === "story" ? "border-[#f2c96b] bg-[#f2c96b]/10" : "border-white/15 hover:border-white/35")} data-testid="wh-video-kind-story">
                <span className="block font-display text-sm font-bold uppercase tracking-wider">The whole story</span>
                <span className="block text-xs text-white/60">The entire history of the Pokémon world in 60 seconds: every chapter&apos;s big moment.</span>
              </button>
              <button type="button" role="radio" aria-checked={kind === "chapter"} disabled={busy} onClick={() => setKind("chapter")} className={cn(tile, kind === "chapter" ? "border-[#f2c96b] bg-[#f2c96b]/10" : "border-white/15 hover:border-white/35")} data-testid="wh-video-kind-chapter">
                <span className="block font-display text-sm font-bold uppercase tracking-wider">One chapter</span>
                <span className="block text-xs text-white/60">A chapter at film speed, every caption with its source.</span>
              </button>
            </div>
            {kind === "chapter" && (
              <div>
                <label htmlFor="wh-video-chapter" className="font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Chapter</label>
                <select id="wh-video-chapter" value={pick} onChange={(e) => setPick(Number(e.target.value))} disabled={busy} className="mt-1 h-11 w-full rounded-lg border border-white/20 bg-[#151228] px-3 font-display text-sm font-semibold text-white" data-testid="wh-video-chapter">
                  {CHAPTERS.map((ch, i) => (
                    <option key={ch.id} value={i}>{ch.numeral}. {ch.title} ({ch.region})</option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-white/55">{Math.round(plan.seconds)} seconds · 1080 × 1920 · {support === "mp4" ? "MP4" : support === "webm" ? "WebM (recorded in real time)" : "not supported in this browser"}</p>
            {phase.kind === "recording" ? (
              <div className="space-y-2" data-testid="wh-video-progress" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {phase.label}</span>
                  <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
                </div>
                <div className="wh-bar"><i style={{ transform: `scaleX(${phase.p})` }} /></div>
                <button type="button" onClick={() => abortRef.current?.abort()} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white" data-testid="wh-video-cancel">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={record} disabled={support === "none"} className="wh-play h-12 w-full justify-center" data-testid="wh-video-make">
                <Clapperboard className="h-4 w-4" aria-hidden /> Make the video
              </button>
            )}
            {phase.kind === "error" && <p className="text-sm text-red-300" role="alert" data-testid="wh-video-error">{phase.message}</p>}
            <p className="text-[11px] leading-relaxed text-white/45">Rendered on this device, frame by frame. Music: the film’s original score (MuseScore General sound font, MIT). Pokémon figures from Pokémon HOME renders.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
