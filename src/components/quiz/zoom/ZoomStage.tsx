"use client";

/* eslint-disable @next/next/no-img-element -- opaque /api/media crops; next/image would re-encode them */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { preloadImage } from "@/lib/preload";
import type { ZoomView, ZoomWindow } from "@/lib/zoom-reveal";
import { cn } from "@/lib/utils";

/**
 * The Zoom Reveal picture. Each step is its own server-cut crop; when the
 * next one has loaded it takes over at exactly the framing of the one
 * before (`from`: where the old crop sits in the new one) and the layer
 * eases out to its full width, with the sharper old crop fading out on top,
 * so a step reads as one continuous zoom-out rather than a new picture.
 * The reveal zooms out the same way, from the last crop to the full artwork.
 */

interface Layer {
  url: string;
  prev?: string;
  from?: ZoomWindow;
  n: number;
}

export function ZoomStage({
  view,
  reveal,
  label,
  className,
}: {
  view: ZoomView;
  /** Once answered: the full artwork and where the last crop sits in it. */
  reveal?: { url: string; from?: ZoomWindow } | null;
  /** The Pokémon's name, shown with the reveal. */
  label?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [layer, setLayer] = useState<Layer>({ url: view.url, n: 0 });
  const shown = useRef(layer.url);
  const target = reveal ? reveal.url : view.url;
  const from = reveal ? reveal.from : view.from;
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (target === shown.current) return;
    let live = true;
    void preloadImage(target).then(() => {
      if (!live) return;
      const prev = shown.current;
      shown.current = target;
      setLayer((l) => ({ url: target, prev, from: from && from.s < 0.999 ? from : undefined, n: l.n + 1 }));
      setRevealed(!!reveal);
    });
    return () => {
      live = false;
    };
    // `from` and `reveal` arrive together with their URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const f = layer.from;
  const animate = !!f && !reduce;
  return (
    <div className={cn("mx-auto w-full max-w-[300px] rounded-lg border-[3px] border-black/70 bg-black/80 p-1.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)] sm:max-w-[400px]", className)}>
      <div className="screen relative aspect-square overflow-hidden rounded-sm" data-testid="zoom-stage" data-step={reveal ? "reveal" : view.step}>
        <motion.div
          key={layer.n}
          className="absolute inset-0 z-[1]"
          style={{ originX: 0, originY: 0 }}
          initial={animate ? { scale: 1 / f!.s, x: `${(-f!.x / f!.s) * 100}%`, y: `${(-f!.y / f!.s) * 100}%` } : false}
          animate={{ scale: 1, x: "0%", y: "0%" }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <img
            src={layer.url}
            alt={revealed && label ? label : `Mystery Pokémon, zoom step ${view.step} of ${view.steps}`}
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
          {animate && layer.prev && (
            <motion.img
              src={layer.prev}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute select-none object-cover"
              style={{ left: `${f!.x * 100}%`, top: `${f!.y * 100}%`, width: `${f!.s * 100}%`, height: `${f!.s * 100}%` }}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            />
          )}
        </motion.div>
        {revealed && label && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="absolute inset-x-0 bottom-0 z-[3] bg-black/75 py-1.5 text-center font-pixel text-[11px] tracking-wider text-white"
          >
            It&apos;s {label}!
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Six pips: steps used (the current one lit), and the points the current step is worth. */
export function ZoomSteps({ step, steps, done }: { step: number; steps: number; done?: "solved" | "missed" }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label={`Zoom step ${step} of ${steps}`} role="img">
      {Array.from({ length: steps }, (_, i) => {
        const n = i + 1;
        return (
          <span
            key={n}
            className={cn(
              "h-2 w-7 rounded-full transition-colors sm:w-9",
              n < step && "bg-foreground/35",
              n === step && (done === "solved" ? "bg-success" : done === "missed" ? "bg-destructive" : "bg-screen shadow-[0_0_10px_-2px_hsl(var(--screen))]"),
              n > step && "bg-foreground/10"
            )}
          />
        );
      })}
    </div>
  );
}
