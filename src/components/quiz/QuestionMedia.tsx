"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, Volume2 } from "lucide-react";
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
  const [revealLoaded, setRevealLoaded] = useState(false);
  const showReveal = revealed && revealSrc && revealLoaded;

  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full max-w-[200px] overflow-hidden rounded-2xl border sm:max-w-[280px]",
        silhouette ? "spotlight" : "bg-muted/40"
      )}
    >
      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/5" aria-hidden />}
      <motion.img
        src={src}
        alt={silhouette ? "Mystery Pokémon silhouette" : label ?? "Pokémon artwork"}
        draggable={false}
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 h-full w-full select-none object-contain p-4 drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
        animate={{ opacity: loaded && !showReveal ? 1 : 0, scale: showReveal ? 0.9 : 1 }}
        transition={{ duration: 0.25 }}
      />
      {revealSrc && revealed && (
        <motion.img
          src={revealSrc}
          alt={label ?? "Revealed Pokémon"}
          draggable={false}
          onLoad={() => setRevealLoaded(true)}
          className="absolute inset-0 h-full w-full select-none object-contain p-4"
          initial={{ opacity: 0, scale: 0.6, rotate: -6 }}
          animate={revealLoaded ? { opacity: 1, scale: 1, rotate: 0 } : {}}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        />
      )}
      <AnimatePresence>
        {showReveal && label && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-background/85 px-3 py-1 text-sm font-bold backdrop-blur"
          >
            It&apos;s {label}!
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="flex flex-col items-center gap-3 py-2">
      <button
        type="button"
        onClick={toggle}
        className="group relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-primary/50 bg-primary/10 transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={playing ? "Stop cry" : "Play cry"}
      >
        {playing && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden />
            <span className="absolute -inset-3 animate-pulse rounded-full border border-primary/30" aria-hidden />
          </>
        )}
        {playing ? <Pause className="h-10 w-10 text-primary" /> : <Play className="ml-1 h-10 w-10 text-primary" />}
      </button>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Volume2 className="h-3.5 w-3.5" aria-hidden />
        {plays === 0 ? "Tap to play the cry" : `Played ${plays}× · tap to replay`}
      </span>
    </div>
  );
}
