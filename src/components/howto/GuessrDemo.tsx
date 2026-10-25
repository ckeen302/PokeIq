"use client";

import { useEffect, useState } from "react";
import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GEO_FALLOFF, GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { DemoFrame, useDemoFrame } from "./shared";

/** A real screenshot (Pallet Town, Red / Blue / Yellow) and the Kanto map crop, scored with the game's own curve. */
const SHOT = "/api/geo/shot/NpDGa_vBMQ0M";
const MAP = { src: "/geo/maps/kanto.webp", w: 763, h: 550, squarePx: 28 };
/** Pallet Town on the crop (world pin 0.68239, 0.55127 on the 5850 x 2565 map, less the crop's origin). */
const ANSWER = { x: 344, y: 356 };
const GUESS = { x: 331, y: 343 };
const px = Math.hypot(GUESS.x - ANSWER.x, GUESS.y - ANSWER.y);
const SCORE = Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-GEO_FALLOFF * px) / Math.hypot(MAP.w, MAP.h)));
const SQUARES = (Math.round((px / MAP.squarePx) * 10) / 10).toFixed(1);
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (p: { x: number; y: number }) => ({ left: `${(p.x / MAP.w) * 100}%`, top: `${(p.y / MAP.h) * 100}%` });

/** 0 screenshot, 1 pin drops, 2 Guess pressed, 3 line draws to the real spot, 4 score counts up (held). */
const MS = [1400, 1200, 700, 900, 3200];

function Count({ to, run }: { to: number; run: boolean }) {
  const [n, setN] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) {
      setN(to);
      return;
    }
    const c = animate(0, to, { duration: 1.1, ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [to, run]);
  return <span className="tabular-nums">{fmt(n)}</span>;
}

export function GuessrDemo() {
  const reduced = !!useReducedMotion();
  const f = useDemoFrame(MS);
  const [shotOk, setShotOk] = useState(true);
  const dur = reduced ? 0 : 0.4;
  return (
    <DemoFrame label={`Demo: a Pokémon screenshot appears, a pin drops on the map, Guess is pressed, a line shows the real spot and the round scores ${fmt(SCORE)} of ${fmt(GEO_MAX_ROUND_SCORE)}`}>
      <div className="mx-auto grid max-w-xl gap-3 sm:grid-cols-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/60">
          {shotOk && (
            // eslint-disable-next-line @next/next/no-img-element -- the game's own cached screenshot
            <img src={SHOT} alt="" onError={() => setShotOk(false)} className="h-full w-full object-cover [image-rendering:pixelated]" />
          )}
          <span className="hud-label absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-white">Where is this?</span>
        </div>
        <div className="space-y-2">
          <div className="relative aspect-[763/550] overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/60">
            {/* eslint-disable-next-line @next/next/no-img-element -- static map crop */}
            <img src={MAP.src} alt="" className="h-full w-full object-cover" />
            <svg viewBox={`0 0 ${MAP.w} ${MAP.h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
              {f >= 3 && (
                <motion.line
                  x1={GUESS.x}
                  y1={GUESS.y}
                  x2={ANSWER.x}
                  y2={ANSWER.y}
                  stroke="#fff"
                  strokeWidth={5}
                  strokeDasharray="10 7"
                  initial={{ pathLength: reduced ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduced ? 0 : 0.7 }}
                />
              )}
            </svg>
            <AnimatePresence>
              {f >= 1 && (
                <motion.span
                  key="pin"
                  initial={{ y: reduced ? 0 : -30, opacity: reduced ? 1 : 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: dur }}
                  className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-destructive shadow"
                  style={pct(GUESS)}
                />
              )}
              {f >= 3 && (
                <motion.span
                  key="spot"
                  initial={{ scale: reduced ? 1 : 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: dur }}
                  className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-success shadow"
                  style={pct(ANSWER)}
                />
              )}
            </AnimatePresence>
          </div>
          <div className="flex h-9 items-center justify-between gap-2">
            <span className={`rounded-md border-2 px-3 py-1 text-xs font-bold uppercase ${f === 2 ? "scale-95 border-primary bg-primary text-primary-foreground" : "border-foreground/15 bg-card text-muted-foreground"}`}>Guess</span>
            {f >= 4 && (
              <span className="text-right text-xs">
                <b className="text-base">
                  <Count to={SCORE} run={!reduced} />
                </b>{" "}
                / {fmt(GEO_MAX_ROUND_SCORE)}
                <br />
                <span className="text-muted-foreground">{SQUARES} map squares away</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </DemoFrame>
  );
}
