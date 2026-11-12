"use client";

import { SITE_URL } from "@/lib/site";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import type { Athlete } from "@/lib/games/athlete";
import { eventOf, formatMark } from "@/lib/games/events";
import type { EventOutcome, GamesResult } from "@/lib/games/games";
import { RACE_URLS } from "@/components/race/urls";
import type { Quality } from "./scene";
import { eventShow } from "./show/build";
import { h2hClip } from "./show/h2h";
import { h2hSummary } from "@/lib/games/h2h";
import { gamesSummary } from "./show/games";
import type { Sequence } from "./show/sequence";
import { gamesVideoPlan, videoSize, type VideoFormat } from "./record";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number; label: string }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string; seconds: number; format: VideoFormat }
  | { kind: "error"; message: string };

function videoSupport(): "mp4" | "webm" | "none" {
  if (typeof window === "undefined") return "none";
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return "mp4";
  if (typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function") return "webm";
  return "none";
}

const param = (k: string) => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };
const lengthFromUrl = () => { const n = Number(param("len")); return Number.isFinite(n) && n >= 3 && n <= 300 ? Math.round(n) : undefined; };
const fpsFromUrl = () => { const n = Number(param("vfps")); return Number.isFinite(n) && n >= 10 && n <= 60 ? Math.round(n) : undefined; };
const qualityFromUrl = (): Quality | undefined => { const q = param("vq"); return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : undefined; };
const formatFromUrl = (): VideoFormat | null => (param("vfmt") === "16:9" ? "16:9" : param("vfmt") === "9:16" ? "9:16" : null);
/** A piece of the timeline (?vfrom=&vto=, seconds): a long render made in resumable pieces (scripts join them). */
const rangeFromUrl = () => {
  const a = Number(param("vfrom")), b = Number(param("vto"));
  return param("vfrom") != null && param("vto") != null && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a ? { from: a, to: b } : undefined;
};

/** The public site's host, never localhost. */
const HOST = new URL(SITE_URL).host;

/**
 * "Make a video" for an event, a head to head or the whole Games: a
 * vertical 1080 × 1920 video (TikTok, Reels, Shorts) or a wide 1920 × 1080
 * one, rendered frame by frame on this device (so it's smooth however slow
 * the device is): the hook card, the broadcast, the slow-motion replay,
 * and the end card with the medallists and the link. The Games make a
 * summary: every event's decisive moments, then the medal table.
 */
export default function MakeGamesVideo(p: { kind: "event" | "games"; outcome: EventOutcome | null; games: GamesResult | null; byKey: ReadonlyMap<string, Athlete>; title: string; slug: string; link: string; h2h: boolean; /** A head to head's two keys in the question's order. */ fieldKeys?: string[]; onRecording(on: boolean): void; onClose(): void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [support, setSupport] = useState<"mp4" | "webm" | "none">("mp4");
  const [format, setFormat] = useState<VideoFormat>("9:16");
  const [canShare, setCanShare] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgress = useRef(0);
  const seconds = useMemo(() => (typeof window === "undefined" ? undefined : lengthFromUrl()), []);

  const parts = useMemo<Sequence[]>(() => {
    if (p.kind === "games" && p.games) return gamesSummary(p.games, p.byKey);
    // A head to head: a short cut (the hook, the deciding stretch, the slow-motion replay); the result card is the recorder's.
    if (p.outcome && p.h2h) return [h2hClip(p.outcome, p.byKey)];
    if (p.outcome) return [eventShow(p.outcome, p.byKey, { budget: 24, video: true, podium: false })];
    return [];
  }, [p.kind, p.games, p.outcome, p.byKey, p.h2h]);
  const length = useMemo(() => gamesVideoPlan(parts, seconds).total, [parts, seconds]);
  const ev = p.outcome ? eventOf(p.outcome.event) : null;
  const hook = p.kind === "games" ? "The PokéIQ Games: every event, every medal 🏅" : p.h2h ? p.title : ev?.hook ?? p.title;
  const sub = p.kind === "games" ? `${p.games?.nations.length ?? 0} nations · based on their stats` : `${ev?.name ?? ""} · based on their stats`;
  const podium = useMemo(() => {
    if (p.kind === "games" && p.games) return p.games.table.slice(0, 3).map((r) => ({ place: String(r.rank), name: r.nation.name, mark: `${r.gold} gold` }));
    const o = p.outcome;
    if (!o) return [];
    const rows: { place: string; name: string; mark: string; key?: string }[] = [];
    ([["1", o.podium.gold], ["2", o.podium.silver], ["3", o.podium.bronze]] as const).forEach(([pl, keys]) => keys.forEach((k) => rows.push({ key: k, place: pl, name: p.byKey.get(k)?.name ?? k, mark: o.event === "wrestling" ? (pl === "1" ? "Gold" : pl === "2" ? "Silver" : "Bronze") : formatMark(o.event, o.marks.get(k)) })));
    return rows;
  }, [p.kind, p.games, p.outcome, p.byKey]);

  /** A head to head's result card: both Pokémon, both results, the margin. */
  const versus = useMemo(() => {
    const o = p.outcome;
    if (!p.h2h || !o) return undefined;
    const keys = o.standings.length === 2 ? [...o.standings] : [];
    const [a, b] = (p.fieldKeys ?? keys).map((k) => p.byKey.get(k));
    if (!a || !b) return undefined;
    const s = h2hSummary(o, a, b);
    return { sides: s.sides, line: s.line };
  }, [p.h2h, p.outcome, p.byKey, p.fieldKeys]);

  useEffect(() => setSupport(videoSupport()), []);
  useEffect(() => { const f = formatFromUrl(); if (f) setFormat(f); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  /** Cancel: the dialog answers at once; the export stops at its next step. */
  function cancel() {
    const ac = abortRef.current;
    if (!ac) return;
    abortRef.current = null;
    ac.abort();
    setPhase({ kind: "idle" });
    p.onRecording(false);
  }

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    lastProgress.current = 0;
    setPhase({ kind: "recording", p: 0, label: "Setting the scene" });
    p.onRecording(true);
    try {
      const { recordGames } = await import("./record");
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
      const res = await recordGames({
        parts,
        format,
        hook,
        sub,
        podium,
        versus,
        endTitle: p.kind === "games" ? "Final medal table" : `${ev?.name ?? ""} · results`,
        slug: p.slug,
        link: `${HOST}${p.link}`,
        byKey: p.byKey,
        urls: RACE_URLS,
        font,
        logo: "/logo.svg",
        seconds,
        quality: qualityFromUrl(),
        fps: fpsFromUrl(),
        range: rangeFromUrl(),
        signal: ac.signal,
        onProgress(pr, label) {
          if (ac.signal.aborted) return;
          const now = performance.now();
          if (now - lastProgress.current < 120 && pr < 1) return;
          lastProgress.current = now;
          setPhase({ kind: "recording", p: pr, label });
        },
      });
      if (ac.signal.aborted) return;
      setPhase({ kind: "done", url: URL.createObjectURL(res.blob), blob: res.blob, name: res.name, type: res.type, seconds: res.seconds, format });
      track("games_video", { kind: p.kind, event: p.outcome?.event ?? "games", format: res.type, aspect: format });
    } catch (e) {
      // (Cancelled: the dialog went back to the start the moment Cancel was pressed.)
      if (ac.signal.aborted || (e as Error)?.name === "AbortError") return;
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        p.onRecording(false);
      }
    }
  }

  async function shareFile() {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    try { await navigator.share({ files: [file], title: hook, text: `${hook} #pokemon #pokeiq` }); } catch { /* closed */ }
  }

  const size = videoSize(format);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="gm-video-title" data-testid="games-video-dialog">
      <motion.div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
        <button type="button" onClick={() => { cancel(); p.onClose(); }} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="games-video-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#ffd84a]" aria-hidden />
          <h2 id="gm-video-title" className="font-display text-lg font-bold uppercase tracking-wider">Make a video</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">{p.kind === "games" ? "A summary of the Games: every event's decisive moments, then the medal table, with the sound." : p.h2h ? "The question, the deciding moment in slow motion, then both results and the link: made for TikTok, Reels and Shorts." : "This broadcast as a video, with the slow-motion replay and the sound."}</p>
        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className={phase.format === "9:16" ? "mx-auto aspect-[9/16] max-h-[52vh] rounded-lg bg-black" : "mx-auto aspect-video w-full rounded-lg bg-black"} data-testid="games-video-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="rc-go inline-flex h-11 items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider" data-testid="games-video-download">
                <Download className="h-4 w-4" aria-hidden /> Download
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="games-video-share">
                <Share2 className="h-4 w-4" aria-hidden /> Share
              </button>
            </div>
            <p className="text-center text-xs text-white/50">{phase.name} · {phase.type === "video/mp4" ? "MP4" : "WebM"} · {phase.seconds.toFixed(1)} s</p>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white">Make another</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Video shape">
              {(["9:16", "16:9"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} disabled={phase.kind === "recording"} onClick={() => setFormat(f)} className={`rounded-lg border px-3 py-2 text-left text-sm ${format === f ? "border-[#ffd84a] bg-white/[0.06]" : "border-white/15 text-white/70"}`} data-testid={`games-video-${f === "9:16" ? "tall" : "wide"}`}>
                  <span className="block font-display text-xs font-bold uppercase tracking-wider">{f === "9:16" ? "Vertical" : "Wide"}</span>
                  <span className="text-xs text-white/55">{f === "9:16" ? "TikTok, Reels, Shorts" : "YouTube, the web"}</span>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
              <p className="font-display font-semibold uppercase tracking-wide text-[#ffd84a]">“{hook}”</p>
              <p className="mt-1 text-white/60">{size.w} × {size.h} · about {Math.round(length)} s · {support === "webm" ? "WebM" : "MP4"}</p>
            </div>
            {phase.kind === "recording" ? (
              <div className="space-y-2" data-testid="games-video-progress" data-p={phase.p.toFixed(3)}>
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {phase.label}</span>
                  <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)} aria-label="Rendering the video">
                  <div className="h-full origin-left rounded-full bg-gradient-to-r from-[#ffd84a] to-[#ff9d00]" style={{ transform: `scaleX(${phase.p})` }} />
                </div>
                <button type="button" onClick={cancel} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="games-video-cancel">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={record} disabled={support === "none" || !parts.length} className="rc-go inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="games-video-record">
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
