"use client";

import { useEffect, useRef, useState } from "react";
import { Flag, MousePointer2 } from "lucide-react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { GEO_FALLOFF, GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { DemoFrame, useDemoFrame } from "./shared";

/** A real Scarlet / Violet screenshot (Levincia) and the Paldea map crop, scored with the game's own curve. */
const SHOT = "/api/geo/preview/demo";
const MAP = { src: "/geo/maps/paldea.webp", w: 614, h: 564, squarePx: 28 };
/** Levincia on the crop (world pin 0.41402, 0.53333 on the 5850 x 2565 map, less the crop's origin at 1907, 1068). */
const ANSWER = { x: 0.41402 * 5850 - 1907, y: 0.53333 * 2565 - 1068 };
const GUESS = { x: ANSWER.x - 14, y: ANSWER.y + 9 };
const ZOOM = 1.7;
const px = Math.hypot(GUESS.x - ANSWER.x, GUESS.y - ANSWER.y);
const SCORE = Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-GEO_FALLOFF * px) / Math.hypot(MAP.w, MAP.h)));
const SQUARES = (Math.round((px / MAP.squarePx) * 10) / 10).toFixed(1);
const fmt = (n: number) => n.toLocaleString("en-US");
const at = (p: { x: number; y: number }) => ({ x: (p.x / MAP.w) * 100, y: (p.y / MAP.h) * 100 });
const pct = (p: { x: number; y: number }) => ({ left: `${at(p).x}%`, top: `${at(p).y}%` });

/** 0 cursor on the screenshot, 1 glides to the map, 2 map zooms, 3 click: pin drops, 4 cursor to Guess, 5 pressed, 6 line + flag, 7 score counts up (held). */
const MS = [1300, 1000, 1000, 900, 900, 500, 1100, 3200];

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
  const root = useRef<HTMLDivElement>(null);
  const shotEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const guessEl = useRef<HTMLSpanElement>(null);
  const [cur, setCur] = useState({ x: 40, y: 40 });
  const zoomed = f >= 2;
  const origin = at(ANSWER);
  useEffect(() => {
    const r = root.current?.getBoundingClientRect();
    const rel = (el: HTMLElement | null, fx: number, fy: number) => {
      const b = el?.getBoundingClientRect();
      return r && b ? { x: b.left - r.left + b.width * fx, y: b.top - r.top + b.height * fy } : null;
    };
    // A map point once the map has zoomed about the answer.
    const onMap = (p: { x: number; y: number }) => {
      const o = at(ANSWER);
      const q = at(p);
      return rel(mapEl.current, (o.x + (q.x - o.x) * ZOOM) / 100, (o.y + (q.y - o.y) * ZOOM) / 100);
    };
    const t =
      f === 0
        ? rel(shotEl.current, 0.55, 0.5)
        : f === 1
          ? rel(mapEl.current, 0.3, 0.7)
          : f === 2
            ? onMap({ x: GUESS.x - 50, y: GUESS.y + 40 })
            : f === 3
              ? onMap(GUESS)
              : rel(guessEl.current, 0.5, 0.5);
    if (t) setCur(t);
  }, [f]);
  const pressed = f === 5;
  return (
    <DemoFrame label={`Demo: a Pokémon screenshot appears, a cursor moves to the map, zooms in and drops a pin, presses Guess, a line shows the real spot and the round scores ${fmt(SCORE)} of ${fmt(GEO_MAX_ROUND_SCORE)}`}>
      <div ref={root} className="relative mx-auto grid max-w-xl grid-cols-2 gap-3">
        <div ref={shotEl} className="relative aspect-[4/3] overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/60">
          {shotOk && (
            // eslint-disable-next-line @next/next/no-img-element -- the game's own cached screenshot
            <img src={SHOT} alt="" onError={() => setShotOk(false)} className="h-full w-full object-cover" />
          )}
          <span className="hud-label absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-white">Where is this?</span>
        </div>
        <div className="space-y-2">
          <div ref={mapEl} className="relative aspect-[614/564] overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/60">
            <motion.div
              className="absolute inset-0"
              style={{ transformOrigin: `${origin.x}% ${origin.y}%` }}
              animate={{ scale: zoomed ? ZOOM : 1 }}
              transition={{ duration: reduced ? 0 : 0.8, ease: "easeInOut" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static map crop */}
              <img src={MAP.src} alt="" className="h-full w-full object-cover" />
              <svg viewBox={`0 0 ${MAP.w} ${MAP.h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                {f >= 6 && (
                  <motion.line
                    x1={GUESS.x}
                    y1={GUESS.y}
                    x2={ANSWER.x}
                    y2={ANSWER.y}
                    stroke="#fff"
                    strokeWidth={3}
                    strokeDasharray="7 5"
                    initial={{ pathLength: reduced ? 1 : 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: reduced ? 0 : 0.7 }}
                  />
                )}
              </svg>
              {f >= 3 && (
                <motion.span
                  initial={{ y: reduced ? 0 : -40, opacity: reduced ? 1 : 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 12 }}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-destructive shadow"
                  style={pct(GUESS)}
                />
              )}
              {f >= 6 && (
                <motion.span
                  initial={{ scale: reduced ? 1 : 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: reduced ? 0 : 0.4 }}
                  className="absolute -translate-x-1/2 -translate-y-full"
                  style={pct(ANSWER)}
                >
                  <Flag className="h-4 w-4 fill-success text-success" aria-hidden />
                </motion.span>
              )}
            </motion.div>
          </div>
          <div className="flex h-9 items-center justify-between gap-2">
            <span
              ref={guessEl}
              className={`rounded-md border-2 px-3 py-1 text-xs font-bold uppercase transition-transform ${f >= 3 ? "border-primary bg-primary text-primary-foreground" : "border-foreground/15 bg-card text-muted-foreground"} ${pressed ? "scale-90" : ""}`}
            >
              Guess
            </span>
            {f >= 7 && (
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
        {!reduced && (
          <motion.span
            className="pointer-events-none absolute left-0 top-0 z-10"
            initial={false}
            animate={{ x: cur.x, y: cur.y, scale: pressed || f === 3 ? 0.85 : 1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          >
            <MousePointer2 className="h-5 w-5 fill-white text-black drop-shadow" aria-hidden />
          </motion.span>
        )}
      </div>
    </DemoFrame>
  );
}
