"use client";

import { useEffect, useRef } from "react";
import type { EraId } from "@/lib/timeline/types";

/**
 * Each generation's signature transition as the flight crosses into its era,
 * 0.6–1 s, drawn over the scene and never in the way of input
 * (pointer-events: none). Abstract nods to each era's hardware, nothing
 * reproduced: the handheld green floods into colour (II), a widescreen frame
 * snaps open (III), the view splits into two screens (IV), a black-and-white
 * sweep (V), a stereoscopic depth pop (VI) and two controller rails snapping
 * in from the sides (VIII). Compositor-only properties (transform, opacity,
 * clip-path), and lighter still at the scene's lowest quality levels.
 */

const CSS = `
.tl-tx { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }

/* II: the old green floods away into colour from the centre, with a bright prismatic front. */
.tl-tx-gbc .tint { position: absolute; inset: 0; background: #8bac0f; mix-blend-mode: color;
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent var(--r), #000 calc(var(--r) + 9%)); mask-image: radial-gradient(circle at 50% 50%, transparent var(--r), #000 calc(var(--r) + 9%));
  animation: tl-flood .95s cubic-bezier(.55,.05,.25,1) forwards; }
.tl-tx-gbc .shade { position: absolute; inset: 0; background: #0f380f; mix-blend-mode: multiply; opacity: .55;
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent var(--r), #000 calc(var(--r) + 9%)); mask-image: radial-gradient(circle at 50% 50%, transparent var(--r), #000 calc(var(--r) + 9%));
  animation: tl-flood .95s cubic-bezier(.55,.05,.25,1) forwards; }
.tl-tx-gbc .front { position: absolute; inset: 0; mix-blend-mode: screen;
  background: radial-gradient(circle at 50% 50%, transparent calc(var(--r) + 3%), rgb(214 51 108 / .28) calc(var(--r) + 5.5%), rgb(255 201 74 / .55) calc(var(--r) + 7.5%), rgb(62 199 194 / .4) calc(var(--r) + 9%), transparent calc(var(--r) + 11%));
  animation: tl-flood .95s cubic-bezier(.55,.05,.25,1) forwards, tl-front-out .95s ease-in forwards; }
@property --r { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
@keyframes tl-flood { from { --r: -12%; } to { --r: 120%; } }
@keyframes tl-front-out { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }

/* III: a widescreen 3:2 frame snaps open from a slit, holds, then opens out past the edges. */
.tl-tx-gba .frame { position: absolute; left: 50%; top: 50%; height: min(64%, 46vw); aspect-ratio: 3 / 2; transform: translate(-50%, -50%) scaleY(.02);
  border-radius: 6px; box-shadow: 0 0 0 200vmax rgb(4 3 18 / .86), 0 0 0 2px rgb(138 125 255 / .9), 0 0 30px 4px rgb(62 160 255 / .45);
  animation: tl-gba .85s cubic-bezier(.2,.9,.25,1) forwards; }
@keyframes tl-gba {
  0% { transform: translate(-50%, -50%) scale(.4, .02); opacity: 1; }
  28% { transform: translate(-50%, -50%) scale(1.03, 1.02); }
  36% { transform: translate(-50%, -50%) scale(1, 1); }
  66% { transform: translate(-50%, -50%) scale(1, 1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; } }

/* IV: the view splits into two screens around a hinge, then closes back up. */
.tl-tx-ds .half { position: absolute; left: 4%; right: 4%; border-radius: 8px; box-shadow: 0 0 0 2px rgb(169 199 255 / .75), 0 0 26px rgb(90 209 255 / .35); opacity: 0; }
.tl-tx-ds .top { top: 3%; bottom: 52%; animation: tl-ds-top .9s cubic-bezier(.2,.9,.25,1) forwards; }
.tl-tx-ds .bot { top: 52%; bottom: 3%; animation: tl-ds-bot .9s cubic-bezier(.2,.9,.25,1) forwards; }
.tl-tx-ds .hinge { position: absolute; left: 0; right: 0; top: 50%; height: 4%; margin-top: -2%; transform: scaleY(0);
  background: linear-gradient(180deg, #05070d, #1a2236 45%, #0a0e18 55%, #05070d); box-shadow: 0 0 0 1px rgb(169 199 255 / .25), 0 0 40px rgb(0 0 0 / .8);
  animation: tl-hinge .9s cubic-bezier(.2,.9,.25,1) forwards; }
@keyframes tl-hinge { 0% { transform: scaleY(0); } 30% { transform: scaleY(1); } 70% { transform: scaleY(1); opacity: 1; } 100% { transform: scaleY(0); opacity: 0; } }
@keyframes tl-ds-top { 0% { opacity: 0; transform: translateY(2%); } 30% { opacity: 1; transform: translateY(-1.5%); } 70% { opacity: .9; transform: translateY(-1.5%); } 100% { opacity: 0; transform: translateY(0); } }
@keyframes tl-ds-bot { 0% { opacity: 0; transform: translateY(-2%); } 30% { opacity: 1; transform: translateY(1.5%); } 70% { opacity: .9; transform: translateY(1.5%); } 100% { opacity: 0; transform: translateY(0); } }

/* V: a black-and-white band sweeps across, draining the colour from what it passes, led by a bright edge. */
.tl-tx-ds2 .band { position: absolute; top: -10%; bottom: -10%; width: 48%; left: 0; transform: translateX(-110%) skewX(-12deg);
  backdrop-filter: grayscale(1) contrast(1.35) brightness(1.08);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 30%, #000 85%, transparent); mask-image: linear-gradient(90deg, transparent, #000 30%, #000 85%, transparent);
  animation: tl-bw .75s cubic-bezier(.55,0,.35,1) forwards; }
.tl-tx-ds2 .edge { position: absolute; top: -10%; bottom: -10%; width: 2px; left: 0; background: #fff; box-shadow: 0 0 18px 3px rgb(255 255 255 / .55), 0 0 60px 10px rgb(79 210 255 / .25);
  transform: translateX(-10vw) skewX(-12deg); animation: tl-bw-edge .75s cubic-bezier(.55,0,.35,1) forwards; }
@keyframes tl-bw { to { transform: translateX(260%) skewX(-12deg); } }
@keyframes tl-bw-edge { 0% { transform: translateX(-10vw) skewX(-12deg); opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(112vw) skewX(-12deg); opacity: 0; } }
.tl-stage[data-q="0"] .tl-tx-ds2 .band { backdrop-filter: none; background: rgb(255 255 255 / .06); }

/* VI: a stereoscopic depth pop: the view lunges forward and its red/cyan fringes converge. */
.tl-stage[data-tx="3ds"] .tl-host { animation: tl-pop .8s cubic-bezier(.2,1.4,.35,1) both; }
@keyframes tl-pop { 0% { transform: scale(1); } 22% { transform: scale(1.07); } 100% { transform: scale(1); } }
.tl-tx-3ds .fringe { position: absolute; inset: 0; border-radius: 4px; opacity: 0; }
.tl-tx-3ds .l { box-shadow: inset 14px 0 0 -6px rgb(255 77 109 / .55), inset 0 0 90px rgb(255 77 109 / .22); animation: tl-fringe-l .8s ease-out forwards; }
.tl-tx-3ds .r { box-shadow: inset -14px 0 0 -6px rgb(63 208 255 / .55), inset 0 0 90px rgb(63 208 255 / .22); animation: tl-fringe-r .8s ease-out forwards; }
@keyframes tl-fringe-l { 0% { opacity: 0; transform: translateX(-3%); } 20% { opacity: 1; transform: translateX(-1.6%); } 100% { opacity: 0; transform: translateX(0); } }
@keyframes tl-fringe-r { 0% { opacity: 0; transform: translateX(3%); } 20% { opacity: 1; transform: translateX(1.6%); } 100% { opacity: 0; transform: translateX(0); } }
.tl-stage[data-tx="3ds"] h1, .tl-stage[data-tx="3ds"] [data-testid="timeline-year"] { animation: tl-ana .8s ease-out both; }
@keyframes tl-ana { 0% { text-shadow: -10px 0 rgb(255 77 109 / .8), 10px 0 rgb(63 208 255 / .8); } 100% { text-shadow: -2px 0 rgb(255 77 109 / .65), 2px 0 rgb(63 208 255 / .65); } }

/* VIII: two controller rails snap in from the sides, click, and slide away. */
.tl-tx-switch .rail { position: absolute; top: 9%; bottom: 9%; width: clamp(38px, 6.5vw, 92px); }
.tl-tx-switch .rail::after { content: ""; position: absolute; left: 50%; top: 22%; width: 38%; aspect-ratio: 1; transform: translateX(-50%); border-radius: 50%;
  background: rgb(0 0 0 / .35); box-shadow: inset 0 0 0 2px rgb(255 255 255 / .25); }
.tl-tx-switch .lft { left: 0; background: linear-gradient(90deg, #009ab5, #00c3e3); border-radius: 0 40px 40px 0; box-shadow: 0 0 40px rgb(0 195 227 / .55);
  animation: tl-rail-l .95s cubic-bezier(.3,1.25,.4,1) forwards; }
.tl-tx-switch .rgt { right: 0; background: linear-gradient(270deg, #d9303f, #ff4554); border-radius: 40px 0 0 40px; box-shadow: 0 0 40px rgb(255 69 84 / .55);
  animation: tl-rail-r .95s cubic-bezier(.3,1.25,.4,1) forwards; }
.tl-tx-switch .rgt::after { top: auto; bottom: 30%; }
.tl-tx-switch .snap { position: absolute; top: 9%; bottom: 9%; width: 2px; background: #fff; opacity: 0; box-shadow: 0 0 18px #fff; animation: tl-snap .95s ease-out forwards; }
.tl-tx-switch .snap.a { left: clamp(38px, 6.5vw, 92px); }
.tl-tx-switch .snap.b { right: clamp(38px, 6.5vw, 92px); }
@keyframes tl-rail-l { 0% { transform: translateX(-110%); } 30% { transform: translateX(0); } 70% { transform: translateX(0); opacity: 1; } 100% { transform: translateX(-110%); opacity: .6; } }
@keyframes tl-rail-r { 0% { transform: translateX(110%); } 30% { transform: translateX(0); } 70% { transform: translateX(0); opacity: 1; } 100% { transform: translateX(110%); opacity: .6; } }
@keyframes tl-snap { 0%, 27% { opacity: 0; } 31% { opacity: 1; } 55% { opacity: 0; } 100% { opacity: 0; } }

/* Lowest quality: no blend modes, just the shapes. */
.tl-stage[data-q="0"] .tl-tx-gbc .tint, .tl-stage[data-q="0"] .tl-tx-gbc .shade { mix-blend-mode: normal; opacity: .35; }
`;

const DUR: Partial<Record<EraId, number>> = { gbc: 950, gba: 850, ds: 900, ds2: 700, "3ds": 800, switch: 950 };

export default function EraTransition({ era, onKick }: { era: EraId; onKick?: (fov: number) => void }) {
  const kick = useRef(onKick);
  kick.current = onKick;
  useEffect(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="timeline-stage"]');
    stage?.setAttribute("data-tx", era);
    if (era === "3ds") kick.current?.(14);
    const id = window.setTimeout(() => stage?.removeAttribute("data-tx"), (DUR[era] ?? 900) + 50);
    return () => { window.clearTimeout(id); stage?.removeAttribute("data-tx"); };
  }, [era]);

  if (!DUR[era]) return null;
  return (
    <div className={`tl-tx tl-tx-${era}`} aria-hidden data-testid="timeline-transition" data-era={era}>
      <style>{CSS}</style>
      {era === "gbc" && (<><div className="shade" /><div className="tint" /><div className="front" /></>)}
      {era === "gba" && <div className="frame" />}
      {era === "ds" && (<><div className="half top" /><div className="half bot" /><div className="hinge" /></>)}
      {era === "ds2" && (<><div className="band" /><div className="edge" /></>)}
      {era === "3ds" && (<><div className="fringe l" /><div className="fringe r" /></>)}
      {era === "switch" && (<><div className="rail lft" /><div className="rail rgt" /><div className="snap a" /><div className="snap b" /></>)}
    </div>
  );
}
