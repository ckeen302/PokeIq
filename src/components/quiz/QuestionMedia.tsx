"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImageOff, Play, RotateCcw, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { preloadAudio, preloadedCry, preloadedImage } from "@/lib/preload";
import { useT } from "@/i18n/client";
import runNs from "@/messages/quiz-run";
import { cryElement, markCryUnlocked, playableCryUrl, wavCryUrl } from "@/lib/cry-audio";

/**
 * Question media. Silhouettes sit on the classic "Who's That Pokémon?"
 * sunburst; once the answer is graded the server hands back a reveal URL
 * and the full artwork pops in over the silhouette.
 */

interface ImageMediaProps {
  src: string;
  revealSrc?: string;
  silhouette: boolean;
  revealed: boolean;
  label?: string;
  /** A run's first picture: fetched ahead of the page's other images. */
  priority?: boolean;
}

export function ImageMedia({ src, revealSrc, silhouette, revealed, label, priority }: ImageMediaProps) {
  const t = useT(runNs);
  // Already downloaded and decoded (a run's first picture, got ready ahead): shown without a fade-in.
  const [loaded, setLoaded] = useState(() => preloadedImage(src) !== null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [revealLoaded, setRevealLoaded] = useState(false);
  const imgSrc = retry ? `${src}${src.includes("?") ? "&" : "?"}r=${retry}` : src;
  const showReveal = revealed && revealSrc && revealLoaded;

  return (
    <div className="mx-auto w-full max-w-[220px] rounded-lg border-[3px] border-black/70 bg-black/80 p-1.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)] sm:max-w-[300px]">
      <div className={cn("screen relative aspect-square rounded-sm", silhouette && "spotlight")}>
        {!loaded && !failed && <div className="absolute inset-0 animate-pulse bg-white/5" aria-hidden />}
        {failed && (
          <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-black/60 text-center text-white">
            <ImageOff className="h-6 w-6" aria-hidden />
            <span className="font-pixel text-[10px] tracking-wider">{t("media.failed")}</span>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setRetry((n) => n + 1);
              }}
              className="flex items-center gap-1 rounded-sm border border-white/30 px-2 py-1 font-pixel text-[10px] hover:bg-white/10"
            >
              <RotateCcw className="h-3 w-3" aria-hidden /> {t("media.retry")}
            </button>
          </div>
        )}
        <motion.img
          key={imgSrc}
          src={imgSrc}
          alt={silhouette ? t("media.silhouette") : label ?? t("media.artwork")}
          draggable={false}
          fetchPriority={priority ? "high" : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 z-[1] h-full w-full select-none object-contain p-4 drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
          animate={{ opacity: loaded && !showReveal ? 1 : 0, scale: showReveal ? 0.9 : 1 }}
          transition={{ duration: 0.25 }}
        />
        {revealSrc && revealed && (
          <motion.img
            src={revealSrc}
            alt={label ?? t("media.revealed")}
            draggable={false}
            onLoad={() => setRevealLoaded(true)}
            className="absolute inset-0 z-[1] h-full w-full select-none object-contain p-4"
            initial={{ opacity: 0, scale: 1.25, filter: "brightness(3)" }}
            animate={revealLoaded ? { opacity: 1, scale: 1, filter: "brightness(1)" } : {}}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        )}
        <AnimatePresence>
          {showReveal && label && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 z-[3] bg-black/75 py-1.5 text-center font-pixel text-[11px] tracking-wider text-white"
            >
              {t("media.itsName", { name: label })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type CryState = "loading" | "playing" | "ready" | "blocked" | "error";

/**
 * A question's cry: it plays by itself as the question appears, and the
 * button plays it again from the start as often as the player likes. Every
 * cry goes through one shared <audio> element (lib/cry-audio.ts), so a new
 * question's cry replaces the last one, and the tap on Start lets it play on
 * iOS. If the browser still refuses to start it alone, the button says
 * "Tap to hear the cry" instead of staying silent. Key it by `src`.
 */
export function CryPlayer({ src }: { src: string }) {
  const t = useT(runNs);
  const [state, setState] = useState<CryState>("loading");
  const [plays, setPlays] = useState(0);
  const controls = useRef<{ play: () => void; reload: () => void } | null>(null);

  useEffect(() => {
    const audio = cryElement();
    if (!audio) return;
    let live = true;
    let url = playableCryUrl(src);
    /** What the element was given for `url`: the downloaded cry when there is one (Safari needs that), else the URL. */
    let given = url;
    const ours = () => live && audio.src === new URL(given, window.location.href).href;

    const play = () => {
      try {
        audio.currentTime = 0;
      } catch {
        // not seekable yet: it starts from the beginning anyway
      }
      audio.play().then(
        () => {
          if (!live) return;
          markCryUnlocked();
          setPlays((n) => n + 1);
        },
        (err: unknown) => {
          if (!ours()) return;
          const name = err instanceof Error ? err.name : "";
          // AbortError: a newer load or a pause replaced this play. NotSupportedError: the error event handles it.
          if (name === "AbortError" || name === "NotSupportedError") return;
          setState(name === "NotAllowedError" ? "blocked" : "error");
        }
      );
    };
    const load = (next: string) => {
      url = next;
      given = preloadedCry(url) ?? url;
      audio.pause();
      audio.dataset.cry = url; // which cry it is, when `src` is the in-memory copy (the e2e test reads it)
      audio.src = given;
      play();
      // Not downloaded yet (a slow connection): fetch it, so a retry plays it from memory.
      if (given === url) void preloadAudio(url);
    };
    const onPlaying = () => ours() && setState("playing");
    const onStopped = () => ours() && setState((s) => (s === "playing" ? "ready" : s));
    const onError = () => {
      if (!ours()) return;
      // A browser that claimed Ogg Vorbis but can't play this file: the WAV plays everywhere.
      if (url !== wavCryUrl(src)) load(wavCryUrl(src));
      else setState("error");
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onStopped);
    audio.addEventListener("ended", onStopped);
    audio.addEventListener("error", onError);
    controls.current = { play, reload: () => load(url) };
    load(url);
    return () => {
      const mine = ours();
      live = false;
      controls.current = null;
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onStopped);
      audio.removeEventListener("ended", onStopped);
      audio.removeEventListener("error", onError);
      // Moving on (or leaving) stops this cry; the next question's cry takes the element over.
      if (mine) audio.pause();
    };
  }, [src]);

  /** Play from the start, even mid-cry. A tap, so it also unlocks autoplay for the next questions. */
  function replay() {
    const c = controls.current;
    if (!c) return;
    if (state === "error") {
      setState("loading");
      c.reload();
    } else c.play();
  }

  const playing = state === "playing";
  const label =
    state === "ready" && plays > 0
      ? t("media.played", { n: plays })
      : state === "ready"
        ? t("media.tap")
        : state === "loading"
          ? t("media.loading")
          : state === "playing"
            ? t("media.playing")
            : state === "blocked"
              ? t("media.blocked")
              : t("media.error");

  return (
    <div className="screen mx-auto flex w-full max-w-sm items-center gap-4 rounded-lg p-4" data-testid="cry-player" data-state={state} data-plays={plays}>
      <button
        type="button"
        onClick={replay}
        className={cn(
          "relative z-[3] flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition active:translate-y-[2px] active:shadow-[0_2px_0_hsl(var(--primary-shadow))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          state === "blocked" && "animate-pulse ring-4 ring-screen/70"
        )}
        aria-label={playing ? t("media.replay") : t("media.play")}
      >
        {playing ? <RotateCcw className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7 fill-current" />}
      </button>
      <div className="relative z-[3] min-w-0 flex-1 space-y-2">
        <div className="flex h-10 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 18 }).map((_, i) => (
            <motion.span
              key={i}
              className="w-full rounded-[1px] bg-screen"
              style={{ boxShadow: "0 0 6px hsl(var(--screen))" }}
              animate={playing ? { height: ["15%", `${30 + ((i * 37) % 70)}%`, "25%", `${20 + ((i * 53) % 80)}%`, "15%"] } : { height: "12%" }}
              transition={playing ? { repeat: Infinity, duration: 0.7, delay: (i % 6) * 0.06 } : { duration: 0.2 }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5 font-pixel text-[10px] uppercase tracking-wider text-screen/80">
          <Volume2 className="h-3 w-3" aria-hidden />
          <span aria-live="polite">{label}</span>
        </div>
      </div>
    </div>
  );
}
