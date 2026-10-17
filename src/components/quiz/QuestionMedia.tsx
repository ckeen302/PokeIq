"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImageOff, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

export function ImageMedia({ src, revealSrc, silhouette, revealed, label }: ImageMediaProps) {
  const [loaded, setLoaded] = useState(false);
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
            <span className="font-pixel text-[10px] tracking-wider">Image didn&apos;t load</span>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setRetry((n) => n + 1);
              }}
              className="flex items-center gap-1 rounded-sm border border-white/30 px-2 py-1 font-pixel text-[10px] hover:bg-white/10"
            >
              <RotateCcw className="h-3 w-3" aria-hidden /> Retry
            </button>
          </div>
        )}
        <motion.img
          key={imgSrc}
          src={imgSrc}
          alt={silhouette ? "Mystery Pokémon silhouette" : label ?? "Pokémon artwork"}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 z-[1] h-full w-full select-none object-contain p-4 drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
          animate={{ opacity: loaded && !showReveal ? 1 : 0, scale: showReveal ? 0.9 : 1 }}
          transition={{ duration: 0.25 }}
        />
        {revealSrc && revealed && (
          <motion.img
            src={revealSrc}
            alt={label ?? "Revealed Pokémon"}
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
              It&apos;s {label}!
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function CryPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [plays, setPlays] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    if (!audio.canPlayType("audio/ogg")) {
      setUnsupported(true);
      return;
    }
    audio.src = src;
    audio.volume = 0.6;
    audioRef.current = audio;
    const onEnd = () => setPlaying(false);
    audio.addEventListener("ended", onEnd);
    // Autoplay works after the player's first click on the page.
    audio
      .play()
      .then(() => {
        setPlaying(true);
        setPlays(1);
      })
      .catch(() => setPlaying(false));
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnd);
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
    } else {
      audio.currentTime = 0;
      void audio.play().then(() => {
        setPlaying(true);
        setPlays((p) => p + 1);
      });
    }
  }

  if (unsupported) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm">
        Your browser can&apos;t play Pokémon cries (Ogg audio). Try Chrome, Firefox or a recent Safari.
      </p>
    );
  }

  return (
    <div className="screen mx-auto flex w-full max-w-sm items-center gap-4 rounded-lg p-4">
      <button
        type="button"
        onClick={toggle}
        className="relative z-[3] flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition active:translate-y-[2px] active:shadow-[0_2px_0_hsl(var(--primary-shadow))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={playing ? "Stop cry" : "Play cry"}
      >
        {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7 fill-current" />}
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
          {plays === 0 ? "Tap to play cry" : `Played ${plays}x · tap to replay`}
        </div>
      </div>
    </div>
  );
}
