"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The timeline's opening, once per browser: a dark handheld-style LCD powers
 * on, "1996" glows up in dot-matrix, the title sweeps in pixel by pixel, then
 * the screen rushes past the camera as it flies in from the dark. About 3.5 s;
 * a click, key, scroll or touch skips it. Original art: no console logo or
 * boot screen is reproduced. Loaded only when it plays.
 */

const CSS = `
.tl-intro { position: absolute; inset: 0; z-index: 30; overflow: hidden; cursor: pointer; background: #020402;
  display: flex; align-items: center; justify-content: center; transition: background-color .9s ease .1s, opacity .35s ease; }
.tl-intro[data-phase="fly"] { background-color: transparent; }
.tl-intro[data-phase="out"] { opacity: 0; background-color: transparent; }
.tl-intro-screen { position: relative; width: min(78vw, 720px); aspect-ratio: 10 / 9; max-height: 74%; border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(10px, 2.2vh, 22px);
  background:
    radial-gradient(circle at center, rgb(155 188 15 / .10) 0 1px, transparent 1.6px) 0 0 / 5px 5px,
    radial-gradient(120% 90% at 50% 45%, #1b3a12 0%, #0c1f0a 62%, #061006 100%);
  box-shadow: 0 0 0 1px rgb(155 188 15 / .18), 0 0 80px rgb(155 188 15 / .16), inset 0 0 60px rgb(0 0 0 / .65);
  transform-origin: 50% 50%;
  animation: tl-lcd-on .62s cubic-bezier(.2,.9,.2,1) both; }
@keyframes tl-lcd-on {
  0% { transform: scale(1, .004); filter: brightness(3); opacity: 0; }
  12% { opacity: 1; }
  45% { transform: scale(1, .004); filter: brightness(3); }
  100% { transform: scale(1, 1); filter: brightness(1); } }
.tl-intro[data-phase="fly"] .tl-intro-screen, .tl-intro[data-phase="out"] .tl-intro-screen {
  animation: tl-lcd-past 1.25s cubic-bezier(.55,0,.85,.35) forwards; }
@keyframes tl-lcd-past { from { transform: scale(1); opacity: 1; } 70% { opacity: .55; } to { transform: scale(7); opacity: 0; } }
.tl-intro-glow { filter: drop-shadow(0 0 10px rgb(155 188 15 / .85)) drop-shadow(0 0 34px rgb(155 188 15 / .45)); }
.tl-intro-year { font-family: var(--font-pixel); font-weight: 700; line-height: .9; letter-spacing: .04em; color: #b8d82a;
  font-size: clamp(64px, 17vw, 190px);
  -webkit-mask-image: radial-gradient(circle at center, #000 0 1.7px, transparent 2.2px); -webkit-mask-size: 5px 5px;
  mask-image: radial-gradient(circle at center, #000 0 1.7px, transparent 2.2px); mask-size: 5px 5px;
  animation: tl-year-in .9s steps(9) .5s both; }
@keyframes tl-year-in { from { opacity: 0; filter: brightness(.2); } to { opacity: 1; filter: brightness(1); } }
.tl-intro-title { position: relative; font-family: var(--font-pixel); font-size: clamp(13px, 2.4vw, 24px); letter-spacing: .32em; text-transform: uppercase;
  color: #e7f5b0; padding-left: .32em; white-space: nowrap;
  clip-path: inset(0 100% 0 0); animation: tl-title-sweep .7s steps(16) .85s forwards; }
@keyframes tl-title-sweep { to { clip-path: inset(0 0 0 0); } }
.tl-intro-title::after { content: ""; position: absolute; top: -4px; bottom: -4px; width: 10px; left: 0; background: #e7f5b0;
  box-shadow: 0 0 16px #b8d82a; animation: tl-title-cursor .7s steps(16) .85s both; }
@keyframes tl-title-cursor { from { left: 0; opacity: 1; } 99% { opacity: 1; } to { left: 100%; opacity: 0; } }
.tl-intro-sub { font-family: var(--font-pixel); font-size: clamp(9px, 1.2vw, 12px); letter-spacing: .3em; text-transform: uppercase; color: rgb(184 216 42 / .6);
  opacity: 0; animation: tl-fade-in .5s ease 1.35s forwards; }
@keyframes tl-fade-in { to { opacity: 1; } }
.tl-intro-scan { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; overflow: hidden; }
.tl-intro-scan::before { content: ""; position: absolute; left: 0; right: 0; height: 30%; top: -30%;
  background: linear-gradient(180deg, transparent, rgb(200 230 60 / .10), transparent); animation: tl-scan 1.6s linear .4s infinite; }
@keyframes tl-scan { to { top: 100%; } }
.tl-intro-skip { position: absolute; bottom: max(16px, 4%); left: 0; right: 0; text-align: center; font-family: var(--font-pixel); font-size: 9px;
  letter-spacing: .3em; text-transform: uppercase; color: rgb(184 216 42 / .55); animation: tl-blink-s 1.1s steps(2) infinite; }
.tl-intro[data-phase="fly"] .tl-intro-skip, .tl-intro[data-phase="out"] .tl-intro-skip { opacity: 0; transition: opacity .3s; }
@keyframes tl-blink-s { 50% { opacity: .25; } }
`;

type Phase = "screen" | "fly" | "out";

export default function TimelineIntro({ ready, flyAt, onFly, onSkip, onDone }: { ready: boolean; flyAt: number; onFly(): void; onSkip(): void; onDone(): void }) {
  const [phase, setPhase] = useState<Phase>("screen");
  const [shown, setShown] = useState(false);
  const t0 = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    t0.current = performance.now();
    setShown(true);
  }, []);

  // The flight starts once the title has had its moment and the scene is built.
  useEffect(() => {
    if (!shown || !ready || phase !== "screen") return;
    const wait = Math.max(0, flyAt - (performance.now() - t0.current));
    const id = window.setTimeout(() => {
      setPhase("fly");
      onFly();
    }, wait);
    return () => window.clearTimeout(id);
  }, [shown, ready, phase, flyAt, onFly]);

  useEffect(() => {
    if (phase === "fly") {
      const id = window.setTimeout(() => setPhase("out"), 1500);
      return () => window.clearTimeout(id);
    }
    if (phase === "out") {
      const id = window.setTimeout(() => { done.current = true; onDone(); }, 380);
      return () => window.clearTimeout(id);
    }
  }, [phase, onDone]);

  // Any input skips it.
  useEffect(() => {
    const skip = (e: Event) => {
      if (done.current) return;
      if (e instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
      if (e.type === "wheel") e.preventDefault();
      onSkip();
      setPhase("out");
    };
    const opts = { capture: true, passive: false } as const;
    window.addEventListener("pointerdown", skip, opts);
    window.addEventListener("keydown", skip, opts);
    window.addEventListener("wheel", skip, opts);
    window.addEventListener("touchstart", skip, opts);
    return () => {
      window.removeEventListener("pointerdown", skip, opts);
      window.removeEventListener("keydown", skip, opts);
      window.removeEventListener("wheel", skip, opts);
      window.removeEventListener("touchstart", skip, opts);
    };
  }, [onSkip]);

  return (
    <div className="tl-intro" data-phase={phase} data-testid="timeline-intro" role="presentation">
      <style>{CSS}</style>
      <div className="tl-intro-screen">
        <div className="tl-intro-scan" aria-hidden />
        <div className="tl-intro-glow" aria-hidden>
          <div className="tl-intro-year">1996</div>
        </div>
        <div className="tl-intro-title">Pokémon Timeline</div>
        <div className="tl-intro-sub" aria-hidden>Thirty years in one flight</div>
      </div>
      <p className="tl-intro-skip">Click, scroll or press any key to skip</p>
    </div>
  );
}
