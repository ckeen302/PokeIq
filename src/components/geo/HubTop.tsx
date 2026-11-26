"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "@/components/ui/Link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Compass, Flame, Pencil, Play, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "@/lib/account";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { Avatar3D, type TrainerPose } from "@/components/trainer3d/Avatar3D";
import { TRAINER_PRESETS, presetTrainer } from "@/lib/trainer/presets";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoSolo from "@/messages/geo-solo";
import geoNs from "@/messages/geo";
import huntNs from "@/messages/hunt";
import avatarNs from "@/messages/avatar";
import creatorNs from "@/messages/trainer-creator";
import { HowToHelpButton } from "./GeoHowToButton";
import worldBody from "@/assets/guessr/hub-world.webp";
import worldAir from "@/assets/guessr/hub-world-air.webp";
// Weather: soft fractal clouds, thinning towards the planet's edge, drawn once to a picture (a live SVG filter under a mask cost frames).
import cloudsArt from "@/assets/guessr/hub-clouds.webp";
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
 * turning slowly (a still of it, drawn by the globe's own scene), the player's trainer standing on it (their 3D
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
  /** Played and saved here: roughly where today's places were ([longitude, latitude]). Never sent before it's played. */
  dailySpots?: [number, number][];
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
  days: { date: string; played: boolean; today: boolean }[];
}

/**
 * Every card's face, the Daily's and each mode's alike: a thick slab of purple, lit along its top edge and with a darker
 * lip along its bottom, a faint dot grain over it.
 */
const FACE =
  "bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1.5px),linear-gradient(180deg,#5444bd_0%,#4334a0_55%,#3a2c8c_100%)] [background-size:9px_9px,100%_100%] shadow-[inset_0_2px_0_rgb(255_255_255/0.22),inset_0_-5px_0_rgb(18_10_60/0.45),0_10px_24px_rgb(0_0_0/0.5)] ring-1 ring-[#2a1f6e]";
const CARD = cn("rounded-2xl", FACE);
/** A section's name as a tab on top of its first card. */
const TAB = "inline-flex items-center rounded-t-xl bg-[#4a3bb0] px-3.5 pb-1 pt-1.5 font-display text-[11px] font-bold uppercase italic leading-none tracking-[0.08em] text-[#d9d2ff] shadow-[inset_0_2px_0_rgb(255_255_255/0.2)] ring-1 ring-[#2a1f6e] md:text-xs";
const LABEL = "font-display text-[10px] font-bold uppercase italic leading-none tracking-[0.12em] text-[#c8bfff] md:text-[11px]";
const TITLE = "font-display font-bold uppercase italic leading-none tracking-wide text-white [text-shadow:0_2px_0_#120f24]";
const GREEN =
  "flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] font-display font-bold uppercase italic tracking-wide text-white shadow-[0_4px_16px_rgb(76_187_23/0.4),inset_0_-4px_0_rgb(0_0_0/0.2),inset_0_2px_0_rgb(255_255_255/0.25)] ring-2 ring-[#1e1a3f]/40 transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60";

/**
 * The still of the world (src/assets/guessr/hub-world.webp, drawn by the globe's scene in the atlas map's colours):
 * the planet alone, facing 20°E 8°N, lit from the camera so it can turn in the page while its light (the shading, and
 * the atmosphere, hub-world-air.webp) stays put. The disc spans WORLD_FRAC of the square.
 */
const WORLD_FRAC = 0.86;
/** The main regions on that face, where the still shows them (% of the square), from the atlas's own region points. */
const WORLD_LABELS: [string, number, number][] = [
  ["Johto", 60.8, 59.1],
  ["Kanto", 86.6, 56.0],
  ["Sinnoh", 70.8, 19.4],
  ["Hoenn", 41.0, 82.9],
  ["Kalos", 21.1, 23.6],
];

/** Where the still faces, fitted to the atlas's region points: an orthographic view of the globe, its disc this far (% of the square) from the centre. */
const GLOBE_FACE = { lon: 19.75, lat: 8.5, r: 45.7 };
/** A point of the globe ([longitude, latitude]) on the still (% of the square), or null round the back. */
function onFace([lon, lat]: [number, number]): [number, number] | null {
  const k = Math.PI / 180;
  const [l, p, l0, p0] = [lon * k, lat * k, GLOBE_FACE.lon * k, GLOBE_FACE.lat * k];
  const z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0);
  if (z < 0.12) return null;
  const x = Math.cos(p) * Math.sin(l - l0);
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0);
  return [50 + x * GLOBE_FACE.r, 50 - y * GLOBE_FACE.r];
}

/** What a hovered mode points at on the globe: one region (an atlas name), or the whole world. */
export type HubFocus = string | "world" | null;


/** The motion: CSS only, and all of it off for reduced motion (the end states are the resting ones). */
const MOTION = `
@keyframes gh-rise { from { transform: translateY(14%) scale(.94); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gh-spin { to { transform: rotate(-360deg) } }
@keyframes gh-unspin { to { transform: rotate(360deg) } }
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
@keyframes gh-twinkle { 0%, 100% { opacity: .15; transform: scale(.6) } 50% { opacity: 1; transform: none } }
@keyframes gh-pin { 0% { transform: translateY(-70%) scale(.2); opacity: 0 } 55% { transform: translateY(6%) scale(1.12, .88); opacity: 1 } 78% { transform: translateY(-8%) } 100% { transform: none; opacity: 1 } }
@keyframes gh-sheen { from { transform: translateX(-120%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
.gh-rise { animation: gh-rise 1.4s cubic-bezier(.16,1,.3,1) both }
.gh-spin { animation: gh-spin 240s linear infinite }
.gh-unspin { animation: gh-unspin 240s linear infinite }
.gh-clouds { animation: gh-spin 150s linear infinite }
.gh-pin { animation: gh-pin .55s cubic-bezier(.3,.9,.4,1) both; transform-origin: 50% 100% }
.gh-drop { animation: gh-drop 1.25s cubic-bezier(.3,0,.3,1) .55s both; transform-origin: 50% 90% }
.gh-shadow { animation: gh-shadow 1.25s ease-out .55s both }
.gh-in-s, .gh-in-e { animation: gh-in-u .7s cubic-bezier(.16,1,.3,1) both }
@media (min-width: 768px) { .gh-in-s { animation-name: gh-in-l } .gh-in-e { animation-name: gh-in-r } }
.gh-in-d { animation: gh-in-d .8s cubic-bezier(.16,1,.3,1) both }
.gh-fade { animation: gh-fade 1s ease-out both }
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

function Space({ children }: { children: React.ReactNode }) {
  return (
    <section
      className={cn(
        // Full width under the header (the page's own padding pulled back), down to the tab bar on a phone.
        "relative mx-[calc(50%-50vw)] -mt-8 overflow-hidden bg-[#09081a] text-white max-md:-mt-6 [.light_&]:bg-[#e3ddff]",
        // A phone's landing runs as long as it needs (nothing laid over the trainer); wider, it fills the screen.
        "md:h-[calc(100svh-7rem-env(safe-area-inset-bottom))] md:min-h-[36rem] lg:h-[calc(100svh-4rem)]",
      )}
      data-testid="geo-home"
    >
      <style>{MOTION}</style>
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
 * Over the still: clouds drifting a little faster than the land, the evening's edge creeping across and back, the
 * region a hovered mode is played in lit, and (once today's Daily is played) roughly where its places were.
 */
function WorldRise({ className, focus, spots, cheer, covered, hopRef }: { className?: string; focus: HubFocus; spots?: [number, number][]; cheer: boolean; covered?: boolean; hopRef: React.Ref<HTMLDivElement> }) {
  const account = useAccount();
  const a = account.user?.avatar ?? null;
  const ta = useT(avatarNs);
  const tc = useT(creatorNs);
  const names = useGeoNames();
  const [label, setLabel] = useState<string | null>(null);
  const lit = label ?? (focus && focus !== "world" ? focus : null);
  const mood = useTrainerMood({ cheer, covered });
  const disc = `${((1 - WORLD_FRAC) / 2) * 100}%`;
  const pins = (spots ?? []).map(onFace).filter((p): p is [number, number] => !!p);
  return (
    <div className={cn("pointer-events-none absolute inset-0 [--gx:50%]", className)}>
      <div
        className="absolute aspect-square -translate-x-1/2"
        style={{ left: "var(--gx)", width: `calc(var(--gd) / ${WORLD_FRAC})`, top: `calc(var(--gt) - var(--gd) * ${(1 / WORLD_FRAC - 1) / 2})` }}
        data-testid="geo-home-world"
        data-focus={lit ?? focus ?? undefined}
      >
        <div className="gh-rise absolute inset-0">
          {/* The atmosphere; it doesn't turn (the light comes from up and to the left). */}
          <Image src={worldAir} alt="" priority unoptimized className="absolute inset-0 h-full w-full select-none" />
          <div className="gh-spin absolute inset-0">
            <Image src={worldBody} alt="" priority unoptimized className="absolute inset-0 h-full w-full select-none" />
          </div>
          <div className="absolute overflow-hidden rounded-full [transform:translateZ(0)]" style={{ inset: disc }}>
            {/* Clouds, turning a little faster than the land, so they drift over it; thin towards the edge. */}
            <div
              className="gh-clouds absolute inset-0 opacity-[.6]"
              style={{ backgroundImage: `url(${cloudsArt.src})`, backgroundSize: "100% 100%" }}
              data-testid="geo-home-clouds"
            />
            {/* The light stays where it is while the world turns: lit up and to the left, night falling to the lower right. */}
            <div
              className="absolute inset-0 [.light_&]:opacity-40"
              style={{
                background: "radial-gradient(circle at 32% 22%, rgb(255 255 255 / .10), transparent 42%), radial-gradient(circle at 34% 26%, transparent 48%, rgb(8 10 40 / .30) 78%, rgb(6 6 24 / .62) 100%)",
              }}
            />
            {/* Evening: a soft edge, warm where the sun sets, on the right (still: a moving layer this size cost frames). */}
            <div
              className="absolute left-[-80%] top-[-80%] h-[260%] w-[260%] [transform:translate(-16%,2%)] [.light_&]:hidden"
              style={{ background: "radial-gradient(circle at 50% 50%, transparent 0 29%, rgb(255 160 90 / .14) 31%, rgb(40 20 80 / .34) 33.5%, rgb(8 8 34 / .58) 37.5%, rgb(6 6 28 / .64) 100%)" }}
              data-testid="geo-home-night"
            />
          </div>
          {/* The whole world in play (Classic, the Daily, the Streak): the planet's rim picked out. */}
          <div
            className={cn("gh-tr absolute rounded-full ring-white/0 transition-[box-shadow,opacity] duration-300", focus === "world" && !label ? "opacity-100" : "opacity-0")}
            style={{ inset: disc, boxShadow: "0 0 0 1.5px rgb(255 255 255 / .55), 0 0 28px 2px rgb(150 170 255 / .28), inset 0 0 26px rgb(170 190 255 / .22)" }}
            aria-hidden
          />
          <div className="gh-spin absolute inset-0">
            {/* The region a hovered mode plays in: a pool of light on the land under its name (kept on the planet). */}
            <div className="absolute overflow-hidden rounded-full" style={{ inset: disc }} aria-hidden>
              {WORLD_LABELS.map(([n, x, y]) => (
                <span
                  key={n}
                  className={cn("gh-tr absolute aspect-square w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-300", lit === n ? "opacity-100" : "opacity-0")}
                  style={{
                    left: `${(x - 50) / WORLD_FRAC + 50}%`,
                    top: `${(y - 50) / WORLD_FRAC + 50}%`,
                    background: "radial-gradient(circle, rgb(255 238 170 / .5), rgb(255 214 90 / .24) 38%, rgb(255 214 90 / .08) 58%, transparent 70%)",
                  }}
                />
              ))}
            </div>
            {/* Today's Daily, played: roughly where its places were (rounded, no names). */}
            {pins.map(([x, y], i) => (
              <span key={`pin-${i}`} className="absolute" style={{ left: `${x}%`, top: `${y}%` }} data-testid="geo-home-pin">
                <span className="gh-unspin block">
                  <span className="gh-pin -ml-[6px] -mt-[16px] block" style={{ animationDelay: `${2.1 + i * 0.12}s` }}>
                    <svg width="12" height="17" viewBox="0 0 10 14" aria-hidden className="drop-shadow-[0_1px_1.5px_rgb(0_0_0/.6)]">
                      <path d="M5 13.5C5 13.5 9.5 8.6 9.5 5A4.5 4.5 0 0 0 .5 5c0 3.6 4.5 8.5 4.5 8.5Z" fill="#ffd23c" stroke="#3a2200" strokeWidth="1" />
                      <circle cx="5" cy="5" r="1.6" fill="#3a2200" />
                    </svg>
                  </span>
                </span>
              </span>
            ))}
            {WORLD_LABELS.map(([n, x, y]) => (
              // On a phone the world is wider than the screen: its names would poke in at the edges, so they're left off.
              <span key={n} className="absolute max-md:hidden" style={{ left: `${x}%`, top: `${y}%` }}>
                <span className="gh-unspin block">
                  <span
                    className={cn(
                      "gh-tr pointer-events-auto block -translate-x-1/2 -translate-y-1/2 cursor-default whitespace-nowrap rounded-[4px] px-1.5 py-[3px] font-display text-[9px] font-bold uppercase leading-none tracking-[0.16em] ring-1 backdrop-blur-[2px] transition-[background-color,color,opacity,box-shadow] duration-300 md:text-[10px]",
                      lit === n ? "bg-[#ffd23c] text-[#2a1a00] shadow-[0_2px_10px_rgb(0_0_0/.45)] ring-[#fff3c4]/70" : "bg-[#120f24]/60 text-white/90 ring-white/20",
                      lit && lit !== n && "opacity-60",
                    )}
                    onPointerEnter={() => setLabel(n)}
                    onPointerLeave={() => setLabel(null)}
                    data-testid="geo-home-region"
                    data-lit={lit === n || undefined}
                  >
                    {names.region(n)}
                  </span>
                </span>
              </span>
            ))}
          </div>
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
        Poké<span className="text-primary">Guessr</span>
      </h1>
      <p className="mt-1.5 text-[clamp(0.8rem,2.2vh,1rem)] text-white/70 max-md:hidden [.light_&]:font-medium [.light_&]:text-[#2a1f6e]/80">{t("hub.tagline")}</p>
    </div>
  );
}

/** The last seven days of the Daily: played ones ticked, today ringed. */
function StreakDays({ days }: { days: HubTopData["days"] }) {
  const t = useT(geoSolo);
  const fmt = new Intl.DateTimeFormat(t.locale, { weekday: "narrow", timeZone: "UTC" });
  return (
    <ol className="flex gap-1 md:gap-[3px]" aria-hidden>
      {days.map((d) => (
        <li key={d.date} className="flex flex-col items-center gap-1">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md md:h-[clamp(1.2rem,1.4vw,1.6rem)] md:w-[clamp(1.2rem,1.4vw,1.6rem)]",
              d.played ? "bg-gradient-to-b from-[#ffd23c] to-[#ff9a1f] text-[#3a2200] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]" : d.today ? "bg-[#120f24]/70 ring-2 ring-[#ffd23c]/80" : "bg-[#120f24]/60 ring-1 ring-white/10",
            )}
          >
            {d.played && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
          </span>
          <span className={cn("font-display text-[10px] font-bold uppercase leading-none", d.today ? "text-[#ffd23c]" : "text-white/55")}>{fmt.format(new Date(d.date + "T12:00:00Z"))}</span>
        </li>
      ))}
    </ol>
  );
}

function DailyCard({ d, onPlay }: { d: HubTopData; onPlay(): void }) {
  const t = useT(geoSolo);
  const g = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  return (
    <div className={cn(CARD, "relative p-3 md:p-3.5")} data-testid="geo-daily-card">
      <Backdrop pattern="daily" />
      {/* The Daily's emblem, top right like every mode's. */}
      <Image src={dailyEmblem} alt="" aria-hidden sizes="96px" className="pointer-events-none absolute -top-5 right-2 h-[3.75rem] w-auto rotate-[6deg] md:-right-3 md:-top-9 md:h-[clamp(3rem,3.6vw,4.75rem)] drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)]" />
      <div className="relative">
        <p className={cn(LABEL, "flex items-center gap-1.5 whitespace-nowrap text-[#ffd23c] md:pr-10 md:text-[clamp(9px,0.7vw,11px)]")}>
          <Compass className="h-3.5 w-3.5" aria-hidden />
          {t("hub.daily.label", { num: d.dailyNum ?? "" })}
          {d.dailyMap && <span className="text-[#c8bfff]">· {d.dailyMap}</span>}
        </p>
        <h2 className={cn(TITLE, "mt-1.5 text-[clamp(1.2rem,3.4vh,1.55rem)] normal-case tracking-normal md:text-[clamp(1rem,1.2vw,1.55rem)] [:lang(en)_&]:capitalize")}>{t("hub.daily.title")}</h2>
        <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3 max-md:flex-nowrap">
          <StreakDays days={d.days} />
          {d.streak > 0 && (
            <p className="flex items-center gap-1 pb-0.5 font-display text-xs font-bold uppercase italic leading-none text-white">
              <Flame className="h-4 w-4 text-[#ff9a1f]" aria-hidden />
              {t("hub.daily.streak", { n: d.streak })}
            </p>
          )}
        </div>
        <div className="mt-3">
          {d.dailyPlayed ? (
            <div className="space-y-1.5 rounded-lg bg-[#120f24]/60 px-3 py-2" data-testid="geo-daily-played">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <p className="whitespace-nowrap font-display text-sm font-bold italic text-[#ffd23c]">{d.dailyScore !== undefined ? t("hub.daily.scored", { score: fmt(d.dailyScore) }) : t("hub.played")}</p>
                {d.onDailyResult && (
                  <button type="button" onClick={d.onDailyResult} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-display text-[11px] font-bold uppercase italic tracking-wide text-white ring-1 ring-white/20 transition-colors hover:bg-white/20" data-testid="geo-daily-result">
                    <Trophy className="h-3.5 w-3.5" aria-hidden />
                    {t("hub.result")}
                  </button>
                )}
              </div>
              <div className="[&>div]:justify-start [&>div]:text-white/75 [&_span]:text-white">
                <NextDailyCountdown label={g("results.nextDaily")} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={cn(GREEN, "h-10 w-full text-base md:h-[clamp(2.1rem,2.5vw,2.9rem)] md:text-[clamp(0.8rem,0.95vw,1.15rem)]")}
              disabled={d.loading || !d.dailyNum}
              onClick={() => {
                onPlay();
                d.onDaily();
              }}
              {...d.dailyWarm}
              data-testid="geo-daily-play"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden />
              {d.dailyResume ? t("hub.daily.resume", { num: d.dailyNum ?? "" }) : t("hub.daily.play")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const LINE = "fill='none' stroke='white' stroke-opacity='.09' stroke-width='1.2'";
/**
 * Each card's faint backdrop, after GeoGuessr's: line art in white at a few percent, what the mode is about
 * (a calendar's grid, a globe's lines, speed lines, radar rings, crossed slashes, rank chevrons, confetti).
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
  duels: { image: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><path d='M0 0L22 22M22 0L0 22' ${LINE}/></svg>`), size: "22px 22px", at: "0 0" },
  ranked: { image: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='18'><path d='M2 14L14 5L26 14' ${LINE}/></svg>`), size: "28px 18px", at: "0 0" },
  party: {
    image: svgUrl(
      `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><g fill='white' fill-opacity='.1'><rect x='6' y='8' width='7' height='3' rx='1' transform='rotate(30 9 9)'/><circle cx='40' cy='12' r='2'/><rect x='48' y='34' width='7' height='3' rx='1' transform='rotate(-40 51 35)'/><circle cx='18' cy='44' r='2.4'/><rect x='30' y='52' width='6' height='3' rx='1' transform='rotate(70 33 53)'/><circle cx='58' cy='58' r='1.6'/><path d='M26 24l2 4l4 1l-3 3l1 4l-4-2l-4 2l1-4l-3-3l4-1z'/></g></svg>`,
    ),
    size: "64px 64px",
    at: "0 0",
  },
} as const;
type Pattern = keyof typeof PATTERNS;

/** A card's backdrop, faint, fading in from its left so the name stays on plain purple. */
function Backdrop({ pattern }: { pattern: Pattern }) {
  const p = PATTERNS[pattern];
  return (
    <span
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl [mask-image:linear-gradient(90deg,rgb(0_0_0/.35),black_55%)]"
      style={{ backgroundImage: p.image, backgroundSize: p.size, backgroundPosition: p.at, backgroundRepeat: p.size.includes("%") ? "no-repeat" : "repeat" }}
      aria-hidden
    />
  );
}

/** A mode as a card: its name top left, its emblem big on the right, bursting out of the card's top edge. */
function ModeTile({
  emblem,
  pattern,
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
      <Backdrop pattern={pattern} />
      <Image
        src={emblem}
        alt=""
        aria-hidden
        sizes="128px"
        className="pointer-events-none absolute -top-[12%] right-[4%] h-[94%] w-auto drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)] transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:rotate-[-4deg] group-hover:scale-105 motion-reduce:transition-none"
      />
      <span className="relative block min-w-0 max-w-[58%] px-3.5 pt-3.5">
        <span className="block font-display text-[1.05rem] font-bold italic leading-[1.05] text-white [text-shadow:0_2px_0_rgb(18_10_60/0.6)] md:text-[clamp(0.95rem,1.1vw,1.45rem)] [:lang(en)_&]:capitalize">{title}</span>
        {sub && <span className="mt-1 block truncate text-[13px] font-semibold text-[#c9c0ff]">{sub}</span>}
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
      <span className="font-display text-[1.2rem] font-bold italic leading-none text-white [text-shadow:0_2px_0_rgb(18_10_60/0.6)]">{label}</span>
      <span className="ml-auto flex items-center" aria-hidden>
        {emblems.map((e, i) => (
          <Image key={i} src={e} alt="" sizes="48px" className="-ml-2.5 h-10 w-10 object-contain drop-shadow-[0_4px_6px_rgb(10_5_40/0.5)] first:ml-0" style={{ transform: `rotate(${(i - 1) * 8}deg)` }} />
        ))}
      </span>
      <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/85 transition-transform duration-300", open && "rotate-180")} aria-hidden />
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

  const tiles = [
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
    <div key="streak" data-testid="region-streak-card">
      <ModeTile
        emblem={streakEmblem}
        pattern="streak"
        title={t("regionStreak.label")}
        href="/pokeguessr/streak"
        testId="region-streak-link"
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
      <WorldRise focus={focus} spots={d.dailyPlayed ? d.dailySpots : undefined} cheer={d.dailyPlayed} covered={d.covered} hopRef={trainer} className={`${LAYOUT} [--ah:9rem] [--gd:min(120vw,34rem)] [--gt:15.5rem] md:[--ah:clamp(8.5rem,26vh,15rem)] md:[--gd:min(44vw,74vh,calc(100vw-2*(var(--side)+var(--cw)+3rem)))] md:[--gt:max(13rem,40%)]`} />
      {/* Phone: below the trainer's patch of the world, the planet fades into space so the cards sit on a clean sky. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[18.5rem] bg-[linear-gradient(180deg,transparent,#09081a_6rem)] md:hidden [.light_&]:bg-[linear-gradient(180deg,transparent,#e4ddff_6rem)]" aria-hidden />
      <HowToHelpButton className="gh-fade absolute right-2 top-2 z-10 text-white max-md:scale-90 md:right-5 md:top-4 [.light_&]:text-[#2a1f6e]" />

      {/*
        Phone: a column (the title, the trainer on the top of the world, the Daily, then each section as a dropdown that
        opens to its cards). Wider: the Daily and the single-player cards stacked down the left, the world in the middle, the
        multiplayer cards down the right; the column's wrapper steps aside (display: contents) so the same cards serve both.
      */}
      <div
        className={cn(
          `pointer-events-none relative z-[1] flex h-full flex-col px-4 pt-3 [&_button]:pointer-events-auto [&_a]:pointer-events-auto ${LAYOUT} [--gap:clamp(0.45rem,0.6vw,0.85rem)]`,
          "md:grid md:grid-cols-[var(--cw)_1fr_var(--cw)] md:grid-rows-[1fr_auto_auto_1fr] md:gap-x-6",
          "md:px-[var(--side)] md:pb-[clamp(1rem,4vh,2.5rem)] md:pt-[clamp(0.75rem,3vh,2rem)]",
        )}
      >
        <div className="md:absolute md:left-1/2 md:top-[clamp(0.75rem,3vh,2rem)] md:-translate-x-1/2">
          <Title />
        </div>
        {/* Phone: the trainer and the top of the world get this room, clear of every card. */}
        <div className="h-[14.5rem] shrink-0 md:hidden" aria-hidden />
        <div className="gh-in-s pointer-events-auto mt-3 md:col-start-1 md:row-start-2 md:mb-[calc(var(--gap)*1.6)] md:mt-0" style={delay(1)} {...points("world")}>
          <DailyCard d={d} onPlay={() => hop(trainer.current)} />
        </div>
        <div className="mt-4 flex flex-col gap-3.5 pb-16 max-md:pointer-events-auto md:contents">
          <div id="hub-solo-modes" className="flex flex-col gap-3.5 md:col-start-1 md:row-start-3 md:gap-[var(--gap)]">
            <div className="gh-in-s md:hidden" style={delay(2)}>
              <DropBar label={t("hub.play.eyebrow")} emblems={[classicEmblem, streakEmblem, huntEmblem]} open={solo} onToggle={() => setSolo((o) => !o)} controls="hub-solo-modes" testId="hub-drop-solo" />
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
          <div id="hub-multi-modes" className="flex flex-col gap-3.5 md:col-start-3 md:row-[2/4] md:justify-center md:gap-[var(--gap)]">
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
