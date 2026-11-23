"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import type { EncodedVideo } from "@/lib/video/encode";
import { useT } from "@/i18n/client";
import labClip from "@/messages/lab-clip";

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; p: number }
  | { kind: "done"; url: string; blob: Blob; name: string; type: string }
  | { kind: "error" };

/** What this browser can make: a video frame by frame (WebCodecs), in real time (MediaRecorder), or none. */
function canMakeVideo(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return true;
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/**
 * "Make a video" for a 3D Lab view that has no video maker of its own (the
 * Professor's Lab, the World Globe): a short vertical clip of what's on
 * screen, made frame by frame by `make` (lib/video/encode.ts), then
 * downloaded or shared straight to an app. Sizes and Mass Battle keep their
 * own, longer makers.
 */
export default function MakeClip({ subject, file, kind, make, onClose }: {
  /** What the clip shows (the dialog's line: "Pikachu on the holo-table"). */
  subject: string;
  /** The download's name, without the extension. */
  file: string;
  /** For analytics. */
  kind: "lab-dex" | "globe";
  make(signal: AbortSignal, onProgress: (p: number) => void): Promise<EncodedVideo>;
  onClose(): void;
}) {
  const t = useT(labClip);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [supported, setSupported] = useState(true);
  const [canShare, setCanShare] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgress = useRef(0);

  useEffect(() => setSupported(canMakeVideo()), []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "done") return;
    const f = new File([phase.blob], phase.name, { type: phase.type });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [f] }));
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  async function record() {
    const ac = new AbortController();
    abortRef.current = ac;
    lastProgress.current = 0;
    setPhase({ kind: "recording", p: 0 });
    try {
      const out = await make(ac.signal, (p) => {
        const now = performance.now();
        if (now - lastProgress.current < 120 && p < 1) return;
        lastProgress.current = now;
        setPhase({ kind: "recording", p });
      });
      const name = `${file}.${out.ext}`;
      setPhase({ kind: "done", url: URL.createObjectURL(out.blob), blob: out.blob, name, type: out.type });
      track("lab_clip", { kind, format: out.type });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setPhase({ kind: "idle" });
      else {
        console.warn("lab clip:", e);
        setPhase({ kind: "error" });
      }
    } finally {
      abortRef.current = null;
    }
  }

  async function shareFile() {
    if (phase.kind !== "done") return;
    try {
      await navigator.share({ files: [new File([phase.blob], phase.name, { type: phase.type })], title: subject, text: `${subject} #pokemon #pokeiq` });
      track("lab_clip_share", { kind });
    } catch {
      // Closed the share sheet.
    }
  }

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[80] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="lab-clip-title" data-testid="lab-clip-dialog" onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <button type="button" onClick={close} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label={t("close")} data-testid="lab-clip-close">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-cyan-200" aria-hidden />
          <h2 id="lab-clip-title" className="font-display text-lg font-bold uppercase tracking-wider">{t("title")}</h2>
        </div>
        <p className="mt-1 text-sm text-white/65">{t("intro")}</p>
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 font-display text-sm font-semibold uppercase tracking-wide text-cyan-200">{subject}</p>

        {phase.kind === "done" ? (
          <div className="mt-4 space-y-3">
            <video src={phase.url} controls playsInline loop autoPlay muted className="mx-auto aspect-[9/16] max-h-[48vh] rounded-lg bg-black" data-testid="lab-clip-preview" />
            <div className="grid grid-cols-2 gap-2">
              <a href={phase.url} download={phase.name} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary font-display text-sm font-bold uppercase tracking-wider text-primary-foreground" data-testid="lab-clip-download" onClick={() => track("lab_clip_download", { kind })}>
                <Download className="h-4 w-4" aria-hidden /> {t("download")}
              </a>
              <button type="button" onClick={shareFile} disabled={!canShare} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 font-display text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40" data-testid="lab-clip-share" title={canShare ? undefined : t("noShare")}>
                <Share2 className="h-4 w-4" aria-hidden /> {t("share")}
              </button>
            </div>
            <p className="text-center text-xs text-white/50">{phase.name}</p>
          </div>
        ) : phase.kind === "recording" ? (
          <div className="mt-4 space-y-2" data-testid="lab-clip-progress" data-p={phase.p.toFixed(3)}>
            <div className="flex items-center justify-between text-xs text-white/70">
              <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t("rendering")}</span>
              <span className="tabular-nums">{Math.round(phase.p * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)} aria-label={t("rendering")}>
              <div className="h-full origin-left rounded-full bg-cyan-300" style={{ transform: `scaleX(${phase.p})` }} />
            </div>
            <button type="button" onClick={() => abortRef.current?.abort()} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="lab-clip-cancel">
              {t("cancel")}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <button type="button" onClick={record} disabled={!supported} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-display text-sm font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50" data-testid="lab-clip-record">
              <Clapperboard className="h-4 w-4" aria-hidden /> {t("record")}
            </button>
            {phase.kind === "error" && <p className="text-sm text-red-300" role="alert">{t("failed")}</p>}
            {!supported && <p className="text-xs text-white/55">{t("noVideo")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
