"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { questionText } from "@/lib/mass-battle/copy";
import type { MBSpecies } from "@/lib/mass-battle/types";
import type { BattleDesc } from "./MassBattleExperience";
import type { Quality } from "./scene";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number; label: string }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string; seconds: number }
  | { kind: "error"; message: string };

const LENGTHS = [15, 30, 60];

function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** "Make a video": the battle as a vertical 1080 × 1920 MP4 for TikTok, Reels and Shorts. */
export default function MakeBattleVideo({ battle, onClose }: { battle: BattleDesc; species: MBSpecies[]; onClose(): void }) {
  const extra = (() => {
    const n = Number(param("len"));
    return Number.isFinite(n) && n >= 3 && n <= 60 ? Math.round(n) : null;
  })();
  const [seconds, setSeconds] = useState<number>(extra ?? 15);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [canShare, setCanShare] = useState(false);
  const [support, setSupport] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgress = useRef(0);

  useEffect(() => setSupport(typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"), []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  const hook = battle.question ? `${questionText(battle.names[0], battle.names[1])} 😳` : battle.hook;
  const lengths = extra && !LENGTHS.includes(extra) ? [extra, ...LENGTHS] : LENGTHS;
  const busy = phase.kind === "recording";

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: "recording", p: 0, label: "Setting up the battle" });
    try {
      const { recordBattleVideo } = await import("./record");
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
      const vq = param("vq");
      const vfps = Number(param("vfps"));
      const res = await recordBattleVideo({
        battle,
        seconds,
        font,
        logo: "/logo.svg",
        quality: vq === "draft" || vq === "low" || vq === "medium" || vq === "high" ? (vq as Quality) : undefined,
        fps: Number.isFinite(vfps) && vfps >= 10 && vfps <= 60 ? Math.round(vfps) : undefined,
        signal: ac.signal,
        onProgress(p, label) {
          const now = performance.now();
          if (now - lastProgress.current < 120 && p < 1) return;
          lastProgress.current = now;
          setPhase({ kind: "recording", p, label });
        },
      });
      setPhase({ kind: "done", url: URL.createObjectURL(res.blob), blob: res.blob, name: res.name, type: res.type, seconds });
      track("mass_battle_video", { preset: battle.presetId ?? "custom", seconds });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setPhase({ kind: "idle" });
      else setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      abortRef.current = null;
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

  const tile = "rounded-md border px-3 py-2 font-display text-xs font-semibold uppercase tracking-wider transition-colors";
  return (
    <div className="absolute inset-0 z-[9] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="mb-video-title" data-testid="mb-video-dialog">
      <div className="relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <button type="button" onClick={() => { abortRef.current?.abort(); onClose(); }} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="mb-video-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#ffd84a]" aria-hidden />
          <h2 id="mb-video-title" className="font-display text-lg font-bold uppercase tracking-wider">Make a video</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">A vertical 1080 × 1920 video of this battle for TikTok, Reels and Shorts, cut by the director, with sound.</p>
        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className="mx-auto aspect-[9/16] max-h-[52vh] rounded-lg bg-black" data-testid="mb-video-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="mb-go inline-flex h-11 items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider" data-testid="mb-video-download">
                <Download className="h-4 w-4" aria-hidden /> Download
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="mb-video-share">
                <Share2 className="h-4 w-4" aria-hidden /> Share
              </button>
            </div>
            <p className="text-center text-xs text-white/50">{phase.name} · MP4 · {phase.seconds} s</p>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white">Make another</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <div className="font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Length</div>
              <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Length">
                {lengths.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={seconds === s} disabled={busy} onClick={() => setSeconds(s)} className={cn(tile, seconds === s ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/75 hover:text-white")} data-testid={`mb-video-length-${s}`}>
                    {s} s
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
              <p className="font-display font-semibold uppercase tracking-wide text-[#ffd84a]">“{hook}”</p>
              <p className="mt-1 text-white/60">1080 × 1920 · MP4</p>
            </div>
            {phase.kind === "recording" ? (
              <div className="space-y-2" data-testid="mb-video-progress" data-p={phase.p.toFixed(3)}>
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {phase.label}</span>
                  <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)} aria-label="Rendering the video">
                  <div className="mb-progress h-full rounded-full" style={{ transform: `scaleX(${phase.p})` }} />
                </div>
                <button type="button" onClick={() => abortRef.current?.abort()} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="mb-video-cancel">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={record} disabled={!support} className="mb-go inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="mb-video-record">
                <Clapperboard className="h-4 w-4" aria-hidden /> Record
              </button>
            )}
            {phase.kind === "error" && <p className="text-sm text-red-300" role="alert">{phase.message}</p>}
            <p className="text-xs leading-relaxed text-white/45">{support ? "Rendered frame by frame on this device, so it stays smooth. Keep this tab open while it records." : "This browser can't make videos. Try Chrome, Edge or Safari."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
