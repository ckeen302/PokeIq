"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { DEFAULT_LENGTH, MIN_SECONDS, VIDEO_H, VIDEO_LENGTHS, VIDEO_W } from "@/lib/sizes/export";
import { PRESETS, presetLineup } from "@/lib/sizes/presets";
import { isDefaultOrder, orderSegment, type Order } from "@/lib/sizes/order";
import type { SizeItem } from "@/lib/sizes/types";
import type { Quality } from "./scene";
import type { RecordStage } from "./record";
import { useT } from "@/i18n/client";
import sizes3d from "@/messages/sizes-3d";
import sizesLines from "@/messages/sizes-lines";
import { dirText, lowerIn, orderLabel, presetHook, presetLabel, stopCaptionText } from "./words";
import { MUSIC_URL } from "./audio";
import { SCENE_URLS } from "./scene-item";
import { trainerFigure } from "./trainer-figure";
import type { TrainerConfig } from "@/lib/trainer/config";
import { cn } from "@/lib/utils";
import type { CityId } from "@/lib/sizes/city";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number; label: RecordStage }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string; seconds: number }
  | { kind: "error"; message: string };

/** What this browser can make: an MP4 frame by frame (WebCodecs), a WebM in real time (MediaRecorder), or nothing. */
export function videoSupport(): "mp4" | "webm" | "none" {
  if (typeof window === "undefined") return "none";
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return "mp4";
  if (typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function") return "webm";
  return "none";
}

/** A length from the address (?len=5) for short test videos, within the export's limits. */
function lengthFromUrl(): number | null {
  try {
    const n = Number(new URLSearchParams(window.location.search).get("len"));
    return Number.isFinite(n) && n >= MIN_SECONDS && n <= 60 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** A frame rate from the address (?vfps=10), for quick automated checks. */
function fpsFromUrl(): number | undefined {
  try {
    const n = Number(new URLSearchParams(window.location.search).get("vfps"));
    return Number.isFinite(n) && n >= 10 && n <= 60 ? Math.round(n) : undefined;
  } catch {
    return undefined;
  }
}

/** A render quality from the address (?vq=draft), for quick automated checks. */
function qualityFromUrl(): Quality | undefined {
  try {
    const q = new URLSearchParams(window.location.search).get("vq");
    return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : undefined;
  } catch {
    return undefined;
  }
}

/**
 * "Make a video": a vertical 1080 × 1920 MP4 of a lineup (this one or a
 * preset), 15, 30 or 60 seconds long, with the hook title card,
 * phone-sized badges, fun-fact captions, the watermark and the end card.
 * It renders frame by frame at a higher quality than the live view, so it
 * is smooth however slow the device; progress shows and it can be
 * cancelled. Then download it, or share the file straight to an app.
 */
export default function MakeVideo({ items, line, order, hook, slug, lineLabel, trainer, city, onRecording, onClose }: {
  items: SizeItem[];
  /** The city the page stands its line in: the video is made there too. */
  city?: CityId;
  line: SizeItem[];
  /** The page's order: the line (and any preset picked here) stands in it. */
  order: Order;
  hook: string;
  slug: string;
  lineLabel: string;
  trainer: TrainerConfig | null;
  onRecording(on: boolean): void;
  onClose(): void;
}) {
  const t = useT(sizes3d);
  const tl = useT(sizesLines);
  const [source, setSource] = useState<string>("current");
  const [extraLen] = useState<number | null>(() => lengthFromUrl());
  const [seconds, setSeconds] = useState<number>(() => extraLen ?? DEFAULT_LENGTH);
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

  const chosen = useMemo(() => {
    if (source === "current") return { items: line, hook, slug, label: lineLabel };
    const p = PRESETS.find((x) => x.id === source)!;
    return { items: presetLineup(p, items, order), hook: presetHook(p.id, order, tl), slug: isDefaultOrder(order) ? p.id : `${p.id}-by-${orderSegment(order)}`, label: presetLabel(p.id, tl) };
  }, [source, line, hook, slug, lineLabel, items, order, tl]);

  const lengths = [...VIDEO_LENGTHS] as number[];
  if (extraLen && !lengths.includes(extraLen)) lengths.unshift(extraLen);
  const busy = phase.kind === "recording";

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    lastProgress.current = 0;
    setPhase({ kind: "recording", p: 0, label: "scene" });
    onRecording(true);
    try {
      const { recordVideo } = await import("./record");
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
      const res = await recordVideo({
        items: chosen.items,
        order,
        seconds,
        hook: chosen.hook,
        slug: chosen.slug,
        urls: SCENE_URLS,
        trainer: trainerFigure(trainer),
        font,
        music: MUSIC_URL,
        logo: "/logo.svg",
        quality: qualityFromUrl(),
        city,
        fps: fpsFromUrl(),
        signal: ac.signal,
        // Another language: the video's captions and its own two lines in it (English pages: record's own English).
        ...(process.env.LIVE_LOCALES && tl.locale !== "en"
          ? { words: { caption: (item: SizeItem | undefined, all: SizeItem[], o: Order, finale: boolean) => stopCaptionText(item, all, o, finale, tl), subtitle: city === "castelia" ? t("v.subtitleCastelia") : t("v.subtitle"), endLine: t("v.endLine") } }
          : {}),
        onProgress(p, label) {
          const now = performance.now();
          if (now - lastProgress.current < 120 && p < 1) return;
          lastProgress.current = now;
          setPhase({ kind: "recording", p, label });
        },
      });
      setPhase({ kind: "done", url: URL.createObjectURL(res.blob), blob: res.blob, name: res.name, type: res.type, seconds });
      track("sizes_video", { lineup: chosen.slug, seconds, format: res.type });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setPhase({ kind: "idle" });
      else setPhase({ kind: "error", message: e instanceof Error && t.locale === "en" ? e.message : t("v.failed") });
    } finally {
      abortRef.current = null;
      onRecording(false);
    }
  }

  async function shareFile() {
    if (phase.kind !== "done") return;
    const file = new File([phase.blob], phase.name, { type: phase.type });
    try {
      await navigator.share({ files: [file], title: chosen.hook, text: `${chosen.hook} #pokemon #pokeiq` });
      track("sizes_video_share", { lineup: chosen.slug });
    } catch {
      // Closed the share sheet.
    }
  }

  const tile = "rounded-md border px-3 py-2 font-display text-xs font-semibold uppercase tracking-wider transition-colors";

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sz-video-title" data-testid="sizes-video-dialog">
      <motion.div
        className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <button type="button" onClick={() => { abortRef.current?.abort(); onClose(); }} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label={t("v.close")} data-testid="sizes-video-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#ffd84a]" aria-hidden />
          <h2 id="sz-video-title" className="font-display text-lg font-bold uppercase tracking-wider">{t("makeVideo")}</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">{t("v.intro")}</p>

        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className="mx-auto aspect-[9/16] max-h-[52vh] rounded-lg bg-black" data-testid="sizes-video-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="sz-play inline-flex h-11 items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider" data-testid="sizes-video-download" onClick={() => track("sizes_video_download", { lineup: chosen.slug })}>
                <Download className="h-4 w-4" aria-hidden /> {t("v.download")}
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="sizes-video-share" title={canShare ? undefined : t("v.noShare")}>
                <Share2 className="h-4 w-4" aria-hidden /> {t("v.share")}
              </button>
            </div>
            <p className="text-center text-xs text-white/50">{phase.name} · {phase.type === "video/mp4" ? "MP4" : "WebM"} · {t("v.seconds", { s: phase.seconds })}</p>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="w-full text-center font-display text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white">{t("v.another")}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="sz-video-lineup" className="font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">{t("v.lineup")}</label>
              <select
                id="sz-video-lineup"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={busy}
                className="mt-1 h-11 w-full rounded-lg border border-white/20 bg-[#121b36] px-3 font-display text-sm font-semibold uppercase tracking-wide text-white"
                data-testid="sizes-video-lineup"
              >
                <option value="current">{t("v.thisLineup", { label: lineLabel })}</option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{presetLabel(p.id, tl)}</option>
                ))}
              </select>
              {!isDefaultOrder(order) && <p className="mt-1.5 text-xs text-white/55" data-testid="sizes-video-order">{chosen.items.length ? t("v.ordered", { label: orderLabel(order.by, tl), dir: lowerIn(dirText(order.by, order.dir, tl), tl), hook: chosen.hook.replace(/\s*\p{Extended_Pictographic}+$/u, "") }) : t("v.nothing", { label: lowerIn(orderLabel(order.by, tl), tl) })}</p>}
            </div>
            <div>
              <div className="font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">{t("v.length")}</div>
              <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("v.length")}>
                {lengths.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={seconds === s} disabled={busy} onClick={() => setSeconds(s)} className={cn(tile, seconds === s ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/75 hover:text-white")} data-testid={`sizes-video-length-${s}`}>
                    {t("v.seconds", { s })}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
              <p className="font-display font-semibold uppercase tracking-wide text-[#ffd84a]">“{chosen.hook}”</p>
              <p className="mt-1 text-white/60">{VIDEO_W} × {VIDEO_H} · {support === "webm" ? "WebM" : "MP4"}</p>
            </div>
            {phase.kind === "recording" ? (
              <div className="space-y-2" data-testid="sizes-video-progress" data-p={phase.p.toFixed(3)}>
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t(`v.stage.${phase.label}`)}</span>
                  <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)} aria-label={t("v.rendering")}>
                  <div className="sz-progress h-full origin-left rounded-full" style={{ transform: `scaleX(${phase.p})` }} />
                </div>
                <button type="button" onClick={() => abortRef.current?.abort()} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="sizes-video-cancel">
                  {t("v.cancel")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={record} disabled={support === "none" || !chosen.items.length} className="sz-play inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="sizes-video-record">
                <Clapperboard className="h-4 w-4" aria-hidden /> {t("v.record")}
              </button>
            )}
            {phase.kind === "error" && <p className="text-sm text-red-300" role="alert">{phase.message}</p>}
            <p className="text-xs leading-relaxed text-white/45">
              {support === "none"
                ? t("v.noVideo")
                : support === "webm"
                  ? t("v.realtime")
                  : t("v.frames")}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
