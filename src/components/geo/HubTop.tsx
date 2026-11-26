"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "@/components/ui/Link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Flame, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "@/lib/account";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { Avatar3D, type TrainerPose } from "@/components/trainer3d/Avatar3D";
import { TRAINER_PRESETS, presetTrainer } from "@/lib/trainer/presets";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoSolo from "@/messages/geo-solo";
import huntNs from "@/messages/hunt";
import avatarNs from "@/messages/avatar";
import creatorNs from "@/messages/trainer-creator";
import { HowToHelpButton } from "./GeoHowToButton";
import { HubGlobe, HUB_GLOBE_FRAC } from "./hub-globe/HubGlobe";
// Every mode's emblem, one family: modelled and lit in three.js for PokéIQ, rendered to stills.
import dailyEmblem from "@/assets/guessr/emblems/daily.webp";
import classicEmblem from "@/assets/guessr/emblems/classic.webp";
import streakEmblem from "@/assets/guessr/emblems/streak.webp";
import huntEmblem from "@/assets/guessr/emblems/hunt.webp";
import duelsEmblem from "@/assets/guessr/emblems/duels.webp";
import rankedEmblem from "@/assets/guessr/emblems/ranked.webp";
import partyEmblem from "@/assets/guessr/emblems/party.webp";

/** Who stands on the globe until a player makes their own 3D trainer (and for visitors): the creator's first look. */
const STAND_IN = presetTrainer(TRAINER_PRESETS[0]);

/**
 * The top of the PokéGuessr hub, after GeoGuessr's home screen: space, the Pokémon world rising from the bottom and
 * turning (the World globe's own, live; drag it to spin it), the player's trainer standing on it (their 3D
 * trainer, else their avatar's Pokémon; signed out, nothing), the Daily and the single-player modes down the left and
 * the multiplayer modes down the right. On a phone: the Daily at the top, every other mode in a row along the bottom.
 * One set of cards serves both layouts.
 */

type Warm = { onPointerEnter(): void; onFocus(): void };

export interface HubTopData {
  /** "#40", once the page knows today's date. */
  dailyNum: string | null;
  dailyMap: string | null;
  dailyPlayed: boolean;
  /** A game is open over the hub. */
  covered?: boolean;
  dailyScore?: number;
  dailyResume: boolean;
  onDaily(): void;
  /** The finished Daily's result, when it's saved here. */
  onDailyResult?: () => void;
  dailyWarm?: Warm;
  classicMap: string;
  classicBest?: number;
  soloOpen: boolean;
  onClassic(): void;
  /** Pokémon Hunt's setup is open on the page (its tile opens it in place, as Classic's does). */
  huntOpen: boolean;
  onHunt(): void;
  regionStreakBest: number;
  onDuels(): void;
  onRanked(): void;
  onParty(): void;
  loading: boolean;
  /** The Daily's streak today (0: none) and the last seven days, oldest first. */
  streak: number;
  /** This week, Monday to Sunday: the days PokéGuessr was played (any mode), today, and the days still to come. */
  days: { date: string; played: boolean; today: boolean; future: boolean }[];
}

/**
 * Every card's face, the Daily's and each mode's alike: a thick slab of purple, lit along its top edge and with a darker
 * lip along its bottom, a faint dot grain over it.
 */
const FACE = cn(
  // By night: a deep violet slab, a soft sheen across its top, a darker lip along its bottom, a faint dot grain.
  "bg-[radial-gradient(120%_85%_at_50%_-25%,rgb(255_255_255/0.2),transparent_55%),radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1.5px),linear-gradient(180deg,#5747d2_0%,#4233ab_55%,#31258a_100%)] [background-size:100%_100%,9px_9px,100%_100%]",
  "shadow-[inset_0_2px_0_rgb(255_255_255/0.24),inset_0_-5px_0_rgb(18_10_60/0.45),0_10px_24px_rgb(0_0_0/0.5)] ring-1 ring-white/10",
  // By day: the same slab in white and lavender, its lip a soft violet, so it sits on the light page like it belongs.
  "[.light_&]:bg-[radial-gradient(120%_85%_at_50%_-25%,rgb(255_255_255/0.95),transparent_55%),radial-gradient(rgb(90_70_210/0.08)_1px,transparent_1.5px),linear-gradient(180deg,#ffffff_0%,#f3efff_55%,#e6dfff_100%)]",
  "[.light_&]:shadow-[inset_0_2px_0_rgb(255_255_255/1),inset_0_-5px_0_rgb(120_100_220/0.24),0_10px_26px_rgb(70_50_170/0.2)] [.light_&]:ring-[#d4c9ff]",
);
const CARD = cn("rounded-2xl", FACE);
/** A section's name as a tab on top of its first card. */
const TAB = "inline-flex items-center rounded-t-xl bg-[#4a3bb0] px-3.5 pb-1 pt-1.5 font-display text-[11px] font-bold uppercase italic leading-none tracking-[0.08em] text-[#d9d2ff] shadow-[inset_0_2px_0_rgb(255_255_255/0.2)] ring-1 ring-white/10 md:text-xs [.light_&]:bg-white [.light_&]:text-[#4a3bb0] [.light_&]:ring-[#d4c9ff] [.light_&]:shadow-[0_-2px_10px_rgb(70_50_170/0.08)]";
const TITLE = "font-display font-bold uppercase italic leading-none tracking-wide text-white [text-shadow:0_2px_0_#120f24]";

/** What a hovered mode points at on the globe: one region (an atlas name), or the whole world. */
export type HubFocus = string | "world" | null;


/** The motion: CSS only, and all of it off for reduced motion (the end states are the resting ones). */
const MOTION = `
@keyframes gh-rise { from { transform: translateY(14%) scale(.94); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-drop {
  0% { transform: translateY(-45vh); opacity: 0 }
  8% { opacity: 1 }
  55% { transform: translateY(0) scaleY(1) }
  62% { transform: translateY(0) scale(1.05, .9) }
  74% { transform: translateY(-7%) scale(.98, 1.03) }
  86% { transform: translateY(0) scale(1.02, .97) }
  93% { transform: translateY(-1.5%) }
  100% { transform: none }
}
@keyframes gh-shadow { 0%, 45% { transform: scale(.2); opacity: 0 } 62% { transform: scale(1.15); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes gh-in-l { from { transform: translateX(-2.5rem); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-in-r { from { transform: translateX(2.5rem); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-in-d { from { transform: translateY(-1rem); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-in-u { from { transform: translateY(1.5rem); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes gh-drift { to { transform: translate3d(var(--dx), 0, 0) } }
@keyframes gh-shine { 0%, 58% { background-position: 160% 0 } 82%, 100% { background-position: -60% 0 } }
@keyframes gh-glow { 0%, 62%, 100% { filter: drop-shadow(0 0 0 rgb(255 60 130 / 0)) } 76% { filter: drop-shadow(0 0 14px rgb(255 60 130 / .75)) } }
@keyframes gh-meteor { 0%, 91% { opacity: 0; transform: translate3d(0, 0, 0) rotate(-32deg) } 92.5% { opacity: 1 } 99% { opacity: 0; transform: translate3d(-30vw, 19vw, 0) rotate(-32deg) } 100% { opacity: 0 } }
@keyframes gh-sparkle { 0%, 80%, 100% { opacity: 0; transform: scale(.2) rotate(0) } 88% { opacity: .9; transform: scale(1) rotate(45deg) } }
@keyframes gh-pulse { 0%, 100% { opacity: .38 } 50% { opacity: .85 } }
@keyframes gh-flicker { 0%, 100% { transform: rotate(8deg) scale(1) } 25% { transform: rotate(6deg) scale(1.03, 1.06) } 50% { transform: rotate(9deg) scale(.98, 1.02) } 75% { transform: rotate(7deg) scale(1.02, .99) } }
@keyframes gh-pop { 0% { transform: scale(0); opacity: 0 } 60% { transform: scale(1.35); opacity: 1 } 100% { transform: scale(1) } }
@keyframes gh-twinkle { 0%, 100% { opacity: .15; transform: scale(.6) } 50% { opacity: 1; transform: none } }
@keyframes gh-sheen { from { transform: translateX(-120%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
.gh-rise { animation: gh-rise 1.4s cubic-bezier(.16,1,.3,1) both }
.gh-drop { animation: gh-drop 1.25s cubic-bezier(.3,0,.3,1) .55s both; transform-origin: 50% 90% }
.gh-shadow { animation: gh-shadow 1.25s ease-out .55s both }
.gh-in-s, .gh-in-e { animation: gh-in-u .7s cubic-bezier(.16,1,.3,1) both }
@media (min-width: 768px) { .gh-in-s { animation-name: gh-in-l } .gh-in-e { animation-name: gh-in-r } }
.gh-in-d { animation: gh-in-d .8s cubic-bezier(.16,1,.3,1) both }
.gh-fade { animation: gh-fade 1s ease-out both }
.gh-shine::before { content: attr(data-text); color: transparent; -webkit-text-fill-color: transparent; background: linear-gradient(105deg, transparent 38%, rgb(255 255 255 / .95) 48%, rgb(255 226 240 / .9) 52%, transparent 62%) 160% 0 / 280% 100% no-repeat; -webkit-background-clip: text; background-clip: text; animation: gh-shine 6s ease-in-out 1.6s infinite }
.gh-glow { animation: gh-glow 6s ease-in-out 1.6s infinite }
.gh-meteor { opacity: 0; transform-origin: 100% 50%; background: linear-gradient(90deg, rgb(255 255 255 / 0), rgb(255 255 255 / .95)); border-radius: 9999px; box-shadow: 0 0 6px rgb(200 190 255 / .8); animation: gh-meteor linear infinite; will-change: transform, opacity }
.gh-sparkle { opacity: 0; background: radial-gradient(circle, #fff 0 18%, transparent 20%), conic-gradient(from 45deg, transparent 0 20%, rgb(124 100 255 / .85) 25%, transparent 30% 45%, rgb(124 100 255 / .85) 50%, transparent 55% 70%, rgb(124 100 255 / .85) 75%, transparent 80% 95%, rgb(124 100 255 / .85) 100%); mask: radial-gradient(circle, black 0 30%, transparent 70%); animation: gh-sparkle ease-in-out infinite }
.gh-pulse { animation: gh-pulse 3.2s ease-in-out infinite }
.gh-flicker { animation: gh-flicker 2.4s ease-in-out infinite; transform-origin: 50% 90% }
.gh-pop { animation: gh-pop .6s cubic-bezier(.3,1.6,.5,1) both }
.gh-px-far, .gh-px-mid, .gh-px-near { transition: transform .6s cubic-bezier(.2,.8,.2,1) }
.gh-px-far { transform: translate3d(calc(var(--px, 0) * 6px), calc(var(--py, 0) * 4px), 0) }
.gh-px-mid { transform: translate3d(calc(var(--px, 0) * -10px), calc(var(--py, 0) * -6px), 0) }
.gh-px-near { transform: translate3d(calc(var(--px, 0) * 4px), calc(var(--py, 0) * 3px), 0) }
.gh-stars { animation: gh-drift 240s linear infinite; will-change: transform }
.gh-twinkle { animation: gh-twinkle 3.2s ease-in-out infinite both }
.gh-lift { transition: transform .25s cubic-bezier(.2,.8,.2,1), filter .2s }
.gh-lift:not(:disabled):hover { transform: translateY(-3px) }
.gh-lift::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; pointer-events: none; background: linear-gradient(90deg, transparent, rgb(255 255 255 / .16), transparent); transform: translateX(-120%) skewX(-18deg) }
.gh-lift:not(:disabled):hover::after { animation: gh-sheen .75s ease-out }
@media (prefers-reduced-motion: reduce) {
  [class*="gh-"], [class*="gh-"]::before, [class*="gh-"]::after { animation: none !important; transition: none !important }
  .gh-lift:hover { transform: none }
}
`;

/** Faint stars that twinkle, over the still starfield (placed by a fixed seed: the same sky every time). */
const TWINKLES = (() => {
  let x = 7;
  const r = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 34 }, () => ({ l: r() * 100, t: r() * 70, s: 1.5 + r() * 2.2, d: r() * 3.2, p: 2.6 + r() * 2.4 }));
})();

/** Shooting stars by night (where each starts, % across and down; its cycle and head start, s): one every few seconds. */
const METEORS = [
  { l: 72, t: 6, p: 11, d: 3 },
  { l: 38, t: 3, p: 17, d: 9 },
  { l: 90, t: 22, p: 14, d: 14 },
];
/** By day, soft sparkles in their place. */
const SPARKLES = [
  { l: 16, t: 14, p: 9, d: 1 },
  { l: 82, t: 9, p: 12, d: 5 },
  { l: 64, t: 32, p: 10, d: 8 },
  { l: 28, t: 40, p: 13, d: 3 },
];

function Space({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // Mouse parallax: the sky, the world and the cards shift a few pixels with the pointer (--px, --py from -1 to 1),
  // so the scene has depth. A fine pointer only, and never under reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!el || still() || !matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const move = (e: PointerEvent) => {
      x = (e.clientX / innerWidth) * 2 - 1;
      y = (e.clientY / innerHeight) * 2 - 1;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty("--px", x.toFixed(3));
          el.style.setProperty("--py", y.toFixed(3));
        });
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <section
      ref={ref}
      className={cn(
        // Full width under the header (the page's own padding pulled back), down to the tab bar on a phone.
        "relative mx-[calc(50%-50vw)] -mt-8 overflow-hidden bg-[#09081a] text-white max-md:-mt-6 [.light_&]:bg-[#e3ddff]",
        // A phone's landing runs as long as it needs (nothing laid over the trainer); wider, it fills the screen.
        "md:h-[calc(100svh-7rem-env(safe-area-inset-bottom))] md:min-h-[36rem] lg:h-[calc(100svh-4rem)]",
      )}
      data-testid="geo-home"
    >
      <style>{MOTION}</style>
      <div className="gh-px-far pointer-events-none absolute -inset-4" aria-hidden>
      {/* Light mode: still space, but bright: a pale lavender void lit by nebulae, the sun flaring in from the upper left, ink-dark stars. */}
      <div className="pointer-events-none absolute inset-0 hidden [.light_&]:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(55%_50%_at_12%_4%,rgb(255_247_224/0.95)_0%,rgb(255_226_240/0.5)_26%,transparent_55%),radial-gradient(45%_40%_at_88%_30%,rgb(196_224_255/0.75)_0%,transparent_70%),radial-gradient(50%_45%_at_22%_78%,rgb(255_205_236/0.55)_0%,transparent_70%),radial-gradient(70%_60%_at_60%_100%,rgb(186_172_255/0.6)_0%,transparent_75%),linear-gradient(180deg,#e6e0ff_0%,#d9d1ff_55%,#ece8ff_100%)]" />
        <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle,rgb(76_60_170/0.55)_0_1px,transparent_1.6px),radial-gradient(circle,rgb(76_60_170/0.35)_0_0.8px,transparent_1.3px)] [background-position:0_0,37px_53px] [background-size:113px_97px,71px_83px]" />
      </div>
      {/* Two layers of the starfield, drifting at different speeds (a slow parallax), and a few stars that twinkle (at night only). */}
      {/* Each layer is a tile wider than the screen, slid along by a transform (moving a background repaints the whole screen every frame). */}
      <div className="gh-stars pointer-events-none absolute inset-y-0 left-0 w-[calc(100%+1200px)] opacity-90 [.light_&]:hidden [--dx:-1200px] [background-image:url(/geo/hub-stars.svg)] [background-size:1200px_800px]" aria-hidden />
      <div className="gh-stars pointer-events-none absolute inset-y-0 left-0 w-[calc(100%+900px)] opacity-90 [.light_&]:hidden [--dx:-900px] [background-image:url(/geo/hub-stars.svg)] [background-position:300px_200px] [background-size:900px_600px]" aria-hidden />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {TWINKLES.map((s, i) => (
          <span key={i} className="gh-twinkle absolute rounded-full bg-white [.light_&]:bg-[#4c3caa]" style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: `${s.d}s`, animationDuration: `${s.p}s` }} />
        ))}
      </div>
        {/* Shooting stars (by night) and sparkles (by day): now and then, never all at once. */}
        {METEORS.map((m, i) => (
          <span key={`m${i}`} className="gh-meteor absolute block h-px w-[clamp(5rem,9vw,9rem)] [.light_&]:hidden" style={{ left: `${m.l}%`, top: `${m.t}%`, animationDuration: `${m.p}s`, animationDelay: `${m.d}s` }} />
        ))}
        {SPARKLES.map((m, i) => (
          <span key={`s${i}`} className="gh-sparkle absolute hidden h-4 w-4 [.light_&]:block" style={{ left: `${m.l}%`, top: `${m.t}%`, animationDuration: `${m.p}s`, animationDelay: `${m.d}s` }} />
        ))}
      </div>
      {children}
      {/* The planet runs on under the fold: the page's own background takes over. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background" aria-hidden />
    </section>
  );
}

const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The trainer's reactions, from the poses it already has: a wave while you point at them, a cheer once today's Daily
 * is done (as the hub comes back into view, or as it opens), a hop as PLAY is pressed. None under reduced motion.
 */
function useTrainerMood({ cheer, covered }: { cheer: boolean; covered?: boolean }) {
  const [painted, setPainted] = useState(false);
  const mounted = useRef(0);
  useEffect(() => void (mounted.current = performance.now()), []);
  const [hover, setHover] = useState(false);
  const [cheering, setCheering] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cheered = useRef(false);
  useEffect(() => {
    if (!cheer || covered || !painted || cheered.current || still()) return;
    // Once the trainer is drawn and has landed (the drop ends 1.8s in); once (the timers below outlive a re-render).
    const t = setTimeout(() => {
      cheered.current = true;
      setCheering(true);
      setTimeout(() => setCheering(false), 3200);
    }, Math.max(350, 2100 - (performance.now() - mounted.current)));
    return () => clearTimeout(t);
  }, [cheer, covered, painted]);
  useEffect(() => {
    if (!cheer) cheered.current = false;
  }, [cheer]);
  useEffect(() => () => clearTimeout(leave.current), []);
  const pose: TrainerPose = cheering ? "victory" : hover ? "wave" : "idle";
  const events = {
    onPointerEnter: () => {
      clearTimeout(leave.current);
      if (!still()) setHover(true);
    },
    // A quick pass still gets a whole wave.
    onPointerLeave: () => {
      clearTimeout(leave.current);
      leave.current = setTimeout(() => setHover(false), 1100);
    },
  };
  return { pose, events, onPaint: () => setPainted(true) };
}

/** A little hop, squash and stretch, on the trainer's own box (the 3D scene keeps drawing inside it). */
export function hop(el: HTMLElement | null) {
  if (!el || still()) return;
  el.animate(
    [
      { transform: "none" },
      { transform: "translateY(0) scale(1.06, .9)", offset: 0.14 },
      { transform: "translateY(-14%) scale(.96, 1.05)", offset: 0.42 },
      { transform: "translateY(0) scale(1.05, .93)", offset: 0.72 },
      { transform: "none" },
    ],
    { duration: 560, easing: "cubic-bezier(.3,0,.3,1)" },
  );
}

/**
 * The world rising from the bottom, turning slowly under the trainer, who drops onto it. Placed by CSS variables on
 * an ancestor: --gd the planet's diameter, --gt where its top is, --gx its centre across, --ah the trainer's height.
 * The planet is the World globe's own (hub-globe/HubGlobe.tsx): it turns, a drag spins it, the region a hovered mode
 * is played in lights up, and (once today's Daily is played) pins show roughly where its places were.
 */
function WorldRise({ className, focus, cheer, covered, hopRef }: { className?: string; focus: HubFocus; cheer: boolean; covered?: boolean; hopRef: React.Ref<HTMLDivElement> }) {
  const account = useAccount();
  const a = account.user?.avatar ?? null;
  const ta = useT(avatarNs);
  const tc = useT(creatorNs);
  const names = useGeoNames();
  const mood = useTrainerMood({ cheer, covered });
  return (
    <div className={cn("gh-px-mid pointer-events-none absolute inset-0 [--gx:50%]", className)}>
      <div
        className="absolute aspect-square -translate-x-1/2"
        style={{ left: "var(--gx)", width: `calc(var(--gd) / ${HUB_GLOBE_FRAC})`, top: `calc(var(--gt) - var(--gd) * ${(1 / HUB_GLOBE_FRAC - 1) / 2})` }}
        data-testid="geo-home-world"
      >
        <div className="gh-rise absolute inset-0">
          {/* The World globe's own world (hub-globe/), turning, to be spun by hand; its names, pins and lights move with it. */}
          <HubGlobe focus={focus} paused={covered} label={(n) => names.region(n)} />
        </div>
      </div>
      {/* Their own 3D trainer, else a stand-in, the creator's first look (until everyone can make one). */}
      <div className="pointer-events-auto absolute -translate-x-1/2" style={{ left: "var(--gx)", top: "calc(var(--gt) - var(--ah) * 0.9)", width: "calc(var(--ah) * 0.8)", height: "var(--ah)" }} {...mood.events}>
        <span className="gh-shadow absolute inset-x-[18%] bottom-[7%] h-[6%] rounded-[50%] bg-[#05040f]/60 blur-[5px] [.light_&]:bg-[#2a1f6e]/20" aria-hidden />
        <div className="gh-drop absolute inset-0" data-testid="geo-home-trainer">
          <div ref={hopRef} className="absolute inset-0 origin-bottom">
            <Avatar3D
              config={a?.trainer ?? STAND_IN}
              pose={mood.pose}
              onPaint={mood.onPaint}
              facing="front"
              label={a?.trainer ? tc("trainerOf", { name: account.user!.username }) : TRAINER_PRESETS[0].name}
            />
          </div>
        </div>
      </div>
      {a && (
        <Link
          href="/trainer/avatar"
          className="gh-fade pointer-events-auto absolute flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#120f24]/85 px-3.5 py-1.5 font-display text-[11px] font-bold uppercase italic tracking-[0.08em] text-white shadow-[0_4px_14px_rgb(0_0_0/0.45)] ring-1 ring-[#a99cff]/50 backdrop-blur transition-colors [animation-delay:2s] hover:bg-[#2d2766] md:text-xs"
          // Beside the trainer, at their knees: clear of the planet's labels.
          style={{ left: "min(calc(var(--gx) + var(--ah) * 0.3), calc(100% - 11rem))", top: "calc(var(--gt) - var(--ah) * 0.3)" }}
          data-testid="geo-home-edit"
        >
          <Pencil className="h-3 w-3" aria-hidden />
          {a.trainer ? ta("editTrainer") : ta("makeTrainer")}
        </Link>
      )}
    </div>
  );
}

function Title() {
  const t = useT(geoSolo);
  return (
    <div className="gh-in-d text-center">
      <h1 className={cn(TITLE, "text-[2.1rem] tracking-tight [text-shadow:0_3px_0_#120f24,0_6px_18px_rgb(0_0_0/0.6)] md:text-[clamp(1.9rem,5.6vh,3.25rem)] [.light_&]:text-[#1d1552] [.light_&]:[text-shadow:0_3px_0_rgb(255_255_255/0.85),0_8px_24px_rgb(120_100_255/0.35)]")}>
        <span className="relative inline-block">
          Poké<span className="gh-glow text-primary">Guessr</span>
          {/* Every few seconds a light sweeps across the name (the same letters again, painted only by the moving light). */}
          <span className="gh-shine pointer-events-none absolute inset-0 select-none [text-shadow:none]" data-text="PokéGuessr" aria-hidden />
        </span>
      </h1>
      <p className="mt-1.5 text-[clamp(0.8rem,2.2vh,1rem)] text-white/70 max-md:hidden [.light_&]:font-medium [.light_&]:text-[#2a1f6e]/80">{t("hub.tagline")}</p>
    </div>
  );
}

/**
 * The streak, after GeoGuessr's: its length on a tab, this week Monday to Sunday (a flame on each day PokéGuessr was
 * played, in any mode; today ringed; the days to come faint), and the flame emblem over its corner.
 */
function StreakCard({ streak, days }: { streak: number; days: HubTopData["days"] }) {
  const t = useT(geoSolo);
  const fmt = new Intl.DateTimeFormat(t.locale, { weekday: "narrow", timeZone: "UTC" });
  return (
    <div className="relative pt-[1.4rem]" data-testid="geo-streak-card">
      <span className={cn(TAB, "absolute left-3 top-0")} data-testid="geo-streak-count">
        {t("hub.daily.streak", { n: streak })}
      </span>
      <div className={cn(CARD, "relative px-3 pb-3 pt-2.5")}>
        <Backdrop pattern="streak" />
        <Image src={streakEmblem} alt="" aria-hidden sizes="96px" className="gh-flicker pointer-events-none absolute -right-2 -top-12 z-[1] h-[4.25rem] w-auto rotate-[8deg] drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)] [.light_&]:drop-shadow-[0_8px_10px_rgb(70_50_170/0.3)] md:-top-[clamp(2.5rem,3vw,3.25rem)] md:h-[clamp(3.25rem,3.8vw,4.75rem)]" />
        <ol className="relative grid grid-cols-7 gap-1 md:gap-[clamp(2px,0.3vw,5px)]" aria-label={t("hub.daily.streak", { n: streak })}>
          {days.map((d) => (
            <li key={d.date} className="flex flex-col items-center gap-1">
              <span className={cn("font-display text-[10px] font-bold uppercase leading-none", d.today ? "text-[#ffd23c] [.light_&]:text-[#c2410c]" : "text-[#b9afff] [.light_&]:text-[#6b5fb5]", d.future && "opacity-50")}>
                {fmt.format(new Date(d.date + "T12:00:00Z"))}
              </span>
              <span
                className={cn(
                  "flex aspect-square w-full items-center justify-center rounded-md max-md:aspect-auto max-md:h-9 font-display text-[clamp(0.7rem,0.85vw,0.95rem)] font-bold leading-none",
                  d.played
                    ? "bg-gradient-to-b from-[#ffb23c] to-[#ff6a1f] text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]"
                    : "bg-[#120f24]/55 text-white/80 [.light_&]:bg-[#e2dbff] [.light_&]:text-[#4b4280]",
                  d.today && "ring-2 ring-[#ffd23c] [.light_&]:ring-[#f59e0b]",
                  d.future && "opacity-40",
                )}
                title={d.played ? t("hub.played") : undefined}
              >
                {d.played ? <Flame className={cn("h-[60%] w-[60%] fill-current", d.today && "gh-pop")} aria-hidden /> : Number(d.date.slice(8))}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const LINE = "fill='none' stroke='white' stroke-width='1.4'";
/**
 * Each card's faint backdrop, after GeoGuessr's: line art in white at a few percent, what the mode is about
 * (a calendar's grid, a globe's lines, speed lines, radar rings, a duel's ring and crossed slashes, rank chevrons under a star, a confetti burst).
 */
const PATTERNS = {
  daily: { image: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><path d='M26 0V26H0' ${LINE}/></svg>`), size: "26px 26px", at: "0 0" },
  classic: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><g ${LINE}><circle cx='60' cy='60' r='56'/><ellipse cx='60' cy='60' rx='38' ry='56'/><ellipse cx='60' cy='60' rx='16' ry='56'/><path d='M60 4V116M4 60H116M12 32H108M12 88H108'/></g></svg>`,
    ),
    size: "auto 165%",
    at: "88% 40%",
  },
  streak: { image: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><path d='M-4 26L26 -4M11 41L41 11' ${LINE}/></svg>`), size: "30px 30px", at: "0 0" },
  hunt: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><g ${LINE}><circle cx='80' cy='80' r='18'/><circle cx='80' cy='80' r='38'/><circle cx='80' cy='80' r='58'/><circle cx='80' cy='80' r='78'/><path d='M80 0V160M0 80H160'/></g></svg>`,
    ),
    size: "auto 190%",
    at: "86% 45%",
  },
  duels: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><g ${LINE}><circle cx='80' cy='80' r='72'/><circle cx='80' cy='80' r='52'/><circle cx='80' cy='80' r='14'/><path d='M22 22L138 138M138 22L22 138M80 8V28M80 132V152M8 80H28M132 80H152'/></g></svg>`,
    ),
    size: "auto 190%",
    at: "86% 45%",
  },
  ranked: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><g ${LINE}><path d='M80 14l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3z'/><path d='M38 104L80 82L122 104M38 126L80 104L122 126M38 148L80 126L122 148'/><path d='M24 60a58 58 0 0 0 20 64M136 60a58 58 0 0 1-20 64'/></g></svg>`,
    ),
    size: "auto 175%",
    at: "86% 42%",
  },
  party: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><g ${LINE}><path d='M80 80L80 10M80 80L130 30M80 80L150 80M80 80L130 130M80 80L80 150M80 80L30 130M80 80L10 80M80 80L30 30' stroke-dasharray='4 9'/><circle cx='80' cy='80' r='24'/></g><g fill='white'><rect x='104' y='22' width='12' height='5' rx='2' transform='rotate(30 110 24)'/><rect x='30' y='48' width='12' height='5' rx='2' transform='rotate(-35 36 50)'/><rect x='118' y='104' width='12' height='5' rx='2' transform='rotate(60 124 106)'/><rect x='40' y='118' width='12' height='5' rx='2' transform='rotate(15 46 120)'/><circle cx='56' cy='22' r='3.5'/><circle cx='138' cy='64' r='3'/><circle cx='22' cy='100' r='3'/><circle cx='100' cy='142' r='3.5'/><path d='M126 140l2.5 5 5.5 .8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z'/><path d='M24 16l2.5 5 5.5 .8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z'/></g></svg>`,
    ),
    size: "auto 190%",
    at: "86% 45%",
  },
} as const;
type Pattern = keyof typeof PATTERNS;

/** Each mode's own colour: a soft light behind its emblem, so no two cards look alike. */
const GLOW: Record<Pattern, string> = {
  daily: "#ff5d5d",
  classic: "#38b6ff",
  streak: "#ff7a1f",
  hunt: "#ff4d79",
  duels: "#ff5470",
  ranked: "#c25cff",
  party: "#ffb52e",
};

/**
 * A card's backdrop: its mode's colour glowing behind the emblem, and its line drawing (white by night, violet by
 * day), fading in from the left so the name stays on a plain face. The drawing is a mask, so one picture serves both.
 */
function Backdrop({ pattern, pulse }: { pattern: Pattern; pulse?: boolean }) {
  const p = PATTERNS[pattern];
  const tile = p.size.includes("%") ? "no-repeat" : "repeat";
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
      <span className={cn("absolute -right-[6%] -top-[30%] aspect-square h-[150%] rounded-full opacity-50 [.light_&]:opacity-35", pulse && "gh-pulse")} style={{ background: `radial-gradient(closest-side, ${GLOW[pattern]}, transparent)` }} />
      <span
        className="absolute inset-0 bg-white/[0.16] [.light_&]:bg-[#5a46d0]/[0.2]"
        style={{
          maskImage: `${p.image}, linear-gradient(90deg, rgb(0 0 0 / .5), black 55%)`,
          WebkitMaskImage: `${p.image}, linear-gradient(90deg, rgb(0 0 0 / .5), black 55%)`,
          maskSize: `${p.size}, 100% 100%`,
          WebkitMaskSize: `${p.size}, 100% 100%`,
          maskPosition: `${p.at}, 0 0`,
          WebkitMaskPosition: `${p.at}, 0 0`,
          maskRepeat: `${tile}, no-repeat`,
          WebkitMaskRepeat: `${tile}, no-repeat`,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      />
    </span>
  );
}

/** A mode as a card: its name top left, its emblem big on the right, bursting out of the card's top edge. */
function ModeTile({
  emblem,
  pattern,
  pulse,
  title,
  sub,
  onClick,
  href,
  testId,
  disabled,
  button,
}: {
  emblem: StaticImageData;
  pattern: Pattern;
  /** The mode's light breathes (the Daily, while today's is still to play). */
  pulse?: boolean;
  title: string;
  /** Where the player stands in it (time left, a best), under the name. */
  sub?: string | null;
  onClick?: () => void;
  href?: string;
  testId?: string;
  disabled?: boolean;
  button?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const body = (
    <>
      <Backdrop pattern={pattern} pulse={pulse} />
      <Image
        src={emblem}
        alt=""
        aria-hidden
        sizes="128px"
        className="pointer-events-none absolute -top-[12%] right-[4%] h-[94%] w-auto drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)] [.light_&]:drop-shadow-[0_8px_10px_rgb(70_50_170/0.3)] transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:rotate-[-4deg] group-hover:scale-105 motion-reduce:transition-none"
      />
      <span className="relative block min-w-0 max-w-[58%] px-3.5 pt-3.5">
        <span className="block font-display text-[1.05rem] font-bold italic leading-[1.05] text-white [text-shadow:0_2px_0_rgb(18_10_60/0.6)] md:text-[clamp(0.95rem,1.1vw,1.45rem)] [:lang(en)_&]:capitalize [.light_&]:text-[#1d1552] [.light_&]:[text-shadow:0_1px_0_rgb(255_255_255/0.9)]">{title}</span>
        {sub && <span className="mt-1 block truncate text-[12px] font-semibold text-[#c9c0ff] [.light_&]:text-[#6b5fb5] md:text-[clamp(11px,0.75vw,13px)]">{sub}</span>}
      </span>
    </>
  );
  const cls = cn(
    CARD,
    "group relative flex h-full w-full flex-col text-left transition-[transform,filter] duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:cursor-default disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:brightness-100",
  );
  return href ? (
    <Link href={href} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} data-testid={testId} {...button}>
      {body}
    </button>
  );
}

/** A phone's section of modes, folded into one bar: its name, its modes' emblems, a chevron; open, its cards drop below. */
function DropBar({ label, emblems, open, onToggle, controls, testId }: { label: string; emblems: StaticImageData[]; open: boolean; onToggle(): void; controls: string; testId: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(CARD, "group relative flex h-[4.25rem] w-full items-center gap-3 overflow-hidden px-4 text-left transition-[filter] active:brightness-110 md:hidden")}
      data-testid={testId}
    >
      <span className="font-display text-[1.2rem] font-bold italic leading-none text-white [text-shadow:0_2px_0_rgb(18_10_60/0.6)] [.light_&]:text-[#1d1552] [.light_&]:[text-shadow:0_1px_0_rgb(255_255_255/0.9)]">{label}</span>
      <span className="ml-auto flex items-center" aria-hidden>
        {emblems.map((e, i) => (
          <Image key={i} src={e} alt="" sizes="48px" className="-ml-2.5 h-10 w-10 object-contain drop-shadow-[0_4px_6px_rgb(10_5_40/0.5)] [.light_&]:drop-shadow-[0_4px_6px_rgb(70_50_170/0.3)] first:ml-0" style={{ transform: `rotate(${(i - 1) * 8}deg)` }} />
        ))}
      </span>
      <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/85 transition-transform duration-300 [.light_&]:text-[#4a3bb0]", open && "rotate-180")} aria-hidden />
    </button>
  );
}

/**
 * The wide layout's measures, shared by the world and the cards around it: --cw a card column's width (GeoGuessr's
 * share of the screen), --side the margin at each edge (from 1280px wide, room for a 160px-wide ad beside the cards).
 * The columns sit the same distance from both edges, and the world fits between them with the same gap each side.
 */
const LAYOUT = "[--cw:min(clamp(12.5rem,13.1vw,17rem),calc((100svh-25rem)/1.8))] [--side:clamp(1rem,calc((100vw-1100px)*0.9),11rem)]";

/** A mode's slot: on a phone a row of its section's dropdown; wider, a card of its column, GeoGuessr's shape (2.24 wide to 1 tall). */
const SLOT = "h-[4.75rem] md:aspect-[2.24/1] md:h-auto md:w-full";

export function HubTop({ d }: { d: HubTopData }) {
  const t = useT(geoSolo);
  // A phone folds each section of modes into a dropdown.
  const [solo, setSolo] = useState(false);
  const [multi, setMulti] = useState(false);
  const h = useT(huntNs);
  const delay = (i: number) => ({ animationDelay: `${0.15 + i * 0.08}s` });
  const [focus, setFocus] = useState<HubFocus>(null);
  const trainer = useRef<HTMLDivElement>(null);
  /** Pointing at (or tabbing to) a mode lights where it's played on the globe. */
  const points = (at: HubFocus) => ({
    onPointerEnter: () => setFocus(at),
    onPointerLeave: () => setFocus(null),
    onFocus: () => setFocus(at),
    onBlur: () => setFocus(null),
  });
  // Classic, the Streak and Hunt are played on the whole world (and its regions).
  const tileFocus: HubFocus[] = ["world", "world", "world"];

  const fmt = (n: number) => formatNumber(n, t.locale);
  const dailyDone = d.dailyPlayed;
  const tiles = [
    // The Daily: today's game (or picking it up), and once it's played, its result.
    <div key="daily" data-testid="geo-daily-card">
      <ModeTile
        emblem={dailyEmblem}
        pattern="daily"
        pulse={!dailyDone && !!d.dailyNum}
        title={t("hub.daily.title")}
        sub={dailyDone ? (d.dailyScore !== undefined ? `${t("hub.played")} · ${fmt(d.dailyScore)}` : t("hub.played")) : d.dailyResume ? t("hub.daily.resume", { num: d.dailyNum ?? "" }) : d.dailyNum ? t("hub.daily.label", { num: d.dailyNum }) : null}
        onClick={
          dailyDone
            ? d.onDailyResult
            : () => {
                hop(trainer.current);
                d.onDaily();
              }
        }
        disabled={dailyDone ? !d.onDailyResult : d.loading || !d.dailyNum}
        button={dailyDone ? undefined : d.dailyWarm}
        testId={dailyDone ? (d.onDailyResult ? "geo-daily-result" : "geo-daily-played") : "geo-daily-play"}
      />
    </div>,
    <div key="classic" data-testid="geo-solo-card">
      <ModeTile
        emblem={classicEmblem}
        pattern="classic"
        title={t("hub.solo.title")}
        onClick={d.onClassic}
        button={{ "aria-expanded": d.soloOpen, "aria-controls": "solo" }}
        testId="geo-solo-setup"
      />
    </div>,
    <div key="hunt">
      <ModeTile emblem={huntEmblem} pattern="hunt" title={h("tile.title")} onClick={d.onHunt} button={{ "aria-expanded": d.huntOpen, "aria-controls": "hunt" }} testId="hunt-hub-entry" />
    </div>,
  ];
  const versus = [
    { emblem: duelsEmblem, pattern: "duels" as const, title: t("hub.multi.duels"), onClick: d.onDuels, testId: "geo-home-duels" },
    { emblem: rankedEmblem, pattern: "ranked" as const, title: t("hub.multi.ranked"), onClick: d.onRanked, testId: "geo-home-ranked" },
    { emblem: partyEmblem, pattern: "party" as const, title: t("hub.multi.party"), onClick: d.onParty, testId: "geo-home-party" },
  ];

  return (
    <Space>
      <WorldRise focus={focus} cheer={d.dailyPlayed} covered={d.covered} hopRef={trainer} className={`${LAYOUT} [--ah:8rem] [--gd:min(80vw,19.5rem)] [--gt:11rem] max-md:[--globe-floor:33rem] md:[--ah:clamp(8.5rem,26vh,15rem)] md:[--gd:min(44vw,74vh,calc(100vw-2*(var(--side)+var(--cw)+3rem)))] md:[--gt:max(13rem,40%)]`} />
      {/* Phone: the whole world shows under the trainer; just its glow fades out above the Daily (the globe draws nothing below --globe-floor). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[30.5rem] bg-[linear-gradient(180deg,transparent,#09081a_2.5rem)] md:hidden [.light_&]:bg-[linear-gradient(180deg,transparent,#e4ddff_2.5rem)]" aria-hidden />
      <HowToHelpButton className="gh-fade absolute right-2 top-2 z-10 text-white max-md:scale-90 md:right-5 md:top-4 [.light_&]:text-[#2a1f6e]" />

      {/*
        Phone: a column (the title, the trainer on the top of the world, the Daily, then each section as a dropdown that
        opens to its cards). Wider: the Daily and the single-player cards stacked down the left, the world in the middle, the
        multiplayer cards down the right; the column's wrapper steps aside (display: contents) so the same cards serve both.
      */}
      <div
        className={cn(
          `gh-px-near pointer-events-none relative z-[1] flex h-full flex-col px-4 pt-3 [&_button]:pointer-events-auto [&_a]:pointer-events-auto ${LAYOUT} [--gap:clamp(0.45rem,0.6vw,0.85rem)]`,
          "md:grid md:grid-cols-[var(--cw)_1fr_var(--cw)] md:grid-rows-[minmax(0,0.55fr)_auto_auto_1fr] md:gap-x-6",
          "md:px-[var(--side)] md:pb-[clamp(1rem,4vh,2.5rem)] md:pt-[clamp(0.75rem,3vh,2rem)]",
        )}
      >
        <div className="md:absolute md:left-1/2 md:top-[clamp(0.75rem,3vh,2rem)] md:-translate-x-1/2">
          <Title />
        </div>
        {/* Phone: the trainer and the whole world get this room, clear of every card. */}
        <div className="h-[28rem] shrink-0 md:hidden" aria-hidden />
        <div className="gh-in-s pointer-events-auto mt-3 md:col-start-1 md:row-start-2 md:mb-[calc(var(--gap)*1.6)] md:mt-0" style={delay(1)} {...points("world")}>
          <StreakCard streak={d.streak} days={d.days} />
        </div>
        <div className="mt-4 flex flex-col gap-3.5 pb-16 max-md:pointer-events-auto md:contents">
          <div id="hub-solo-modes" className="flex flex-col gap-3.5 md:col-start-1 md:row-start-3 md:gap-[var(--gap)]">
            <div className="gh-in-s md:hidden" style={delay(2)}>
              <DropBar label={t("hub.play.eyebrow")} emblems={[dailyEmblem, classicEmblem, huntEmblem]} open={solo} onToggle={() => setSolo((o) => !o)} controls="hub-solo-modes" testId="hub-drop-solo" />
            </div>
            <span className={cn(TAB, "gh-in-s ml-3 -mb-[var(--gap)] self-start max-md:hidden")} style={delay(2)}>
              {t("hub.play.eyebrow")}
            </span>
            {tiles.map((tile, i) => (
              <div key={i} className={cn("gh-in-s pointer-events-auto [&>div]:h-full", SLOT, !solo && "max-md:hidden")} style={delay(3 + i)} {...points(tileFocus[i])}>
                {tile}
              </div>
            ))}
          </div>
          <div id="hub-multi-modes" className="flex flex-col gap-3.5 md:col-start-3 md:row-start-3 md:gap-[var(--gap)]">
            <div className="gh-in-e md:hidden" style={delay(3)}>
              <DropBar label={t("hub.multi.title")} emblems={[duelsEmblem, rankedEmblem, partyEmblem]} open={multi} onToggle={() => setMulti((o) => !o)} controls="hub-multi-modes" testId="hub-drop-multi" />
            </div>
            <span className={cn(TAB, "gh-in-e ml-3 -mb-[var(--gap)] self-start max-md:hidden")} style={delay(1)}>
              {t("hub.multi.title")}
            </span>
            {versus.map((v, i) => (
              <div key={v.testId} className={cn("gh-in-e [&>button]:h-full", SLOT, !multi && "max-md:hidden")} style={delay(2 + i)}>
                <ModeTile emblem={v.emblem} pattern={v.pattern} title={v.title} onClick={v.onClick} testId={v.testId} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Space>
  );
}
