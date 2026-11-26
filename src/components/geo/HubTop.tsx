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
const LABEL = "font-display text-[10px] font-bold uppercase italic leading-none tracking-[0.12em] text-[#c8bfff] md:text-[11px]";
const TITLE = "font-display font-bold uppercase italic leading-none tracking-wide text-white [text-shadow:0_2px_0_#120f24]";
const GREEN =
  "flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] font-display font-bold uppercase italic tracking-wide text-white shadow-[0_4px_16px_rgb(76_187_23/0.4),inset_0_-4px_0_rgb(0_0_0/0.2),inset_0_2px_0_rgb(255_255_255/0.25)] ring-2 ring-[#1e1a3f]/40 transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60";

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
@keyframes gh-twinkle { 0%, 100% { opacity: .15; transform: scale(.6) } 50% { opacity: 1; transform: none } }
@keyframes gh-sheen { from { transform: translateX(-120%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
.gh-rise { animation: gh-rise 1.4s cubic-bezier(.16,1,.3,1) both }
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
 * The planet is the World globe's own (hub-globe/HubGlobe.tsx): it turns, a drag spins it, the region a hovered mode
 * is played in lights up, and (once today's Daily is played) pins show roughly where its places were.
 */
function WorldRise({ className, focus, spots, cheer, covered, hopRef }: { className?: string; focus: HubFocus; spots?: [number, number][]; cheer: boolean; covered?: boolean; hopRef: React.Ref<HTMLDivElement> }) {
  const account = useAccount();
  const a = account.user?.avatar ?? null;
  const ta = useT(avatarNs);
  const tc = useT(creatorNs);
  const names = useGeoNames();
  const mood = useTrainerMood({ cheer, covered });
  return (
    <div className={cn("pointer-events-none absolute inset-0 [--gx:50%]", className)}>
      <div
        className="absolute aspect-square -translate-x-1/2"
        style={{ left: "var(--gx)", width: `calc(var(--gd) / ${HUB_GLOBE_FRAC})`, top: `calc(var(--gt) - var(--gd) * ${(1 / HUB_GLOBE_FRAC - 1) / 2})` }}
        data-testid="geo-home-world"
      >
        <div className="gh-rise absolute inset-0">
          {/* The World globe's own world (hub-globe/), turning, to be spun by hand; its names, pins and lights move with it. */}
          <HubGlobe focus={focus} spots={spots} paused={covered} label={(n) => names.region(n)} />
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
              d.played ? "bg-gradient-to-b from-[#ffd23c] to-[#ff9a1f] text-[#3a2200] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]" : d.today ? "bg-[#120f24]/70 ring-2 ring-[#ffd23c]/80 [.light_&]:bg-white [.light_&]:ring-[#f59e0b]" : "bg-[#120f24]/60 ring-1 ring-white/10 [.light_&]:bg-[#e2dbff] [.light_&]:ring-[#cfc4ff]",
            )}
          >
            {d.played && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
          </span>
          <span className={cn("font-display text-[10px] font-bold uppercase leading-none", d.today ? "text-[#ffd23c] [.light_&]:text-[#c2410c]" : "text-white/55 [.light_&]:text-[#6b5fb5]")}>{fmt.format(new Date(d.date + "T12:00:00Z"))}</span>
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
      <Image src={dailyEmblem} alt="" aria-hidden sizes="96px" className="pointer-events-none absolute -top-5 right-2 h-[3.75rem] w-auto rotate-[6deg] md:-right-3 md:-top-9 md:h-[clamp(3rem,3.6vw,4.75rem)] drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)] [.light_&]:drop-shadow-[0_8px_10px_rgb(70_50_170/0.3)]" />
      <div className="relative">
        <p className={cn(LABEL, "flex items-center gap-1.5 whitespace-nowrap text-[#ffd23c] [.light_&]:text-[#c2410c] md:pr-10 md:text-[clamp(9px,0.7vw,11px)]")}>
          <Compass className="h-3.5 w-3.5" aria-hidden />
          {t("hub.daily.label", { num: d.dailyNum ?? "" })}
          {d.dailyMap && <span className="text-[#c8bfff] [.light_&]:text-[#6b5fb5]">· {d.dailyMap}</span>}
        </p>
        <h2 className={cn(TITLE, "mt-1.5 text-[clamp(1.2rem,3.4vh,1.55rem)] normal-case tracking-normal md:text-[clamp(1rem,1.2vw,1.55rem)] [:lang(en)_&]:capitalize [.light_&]:text-[#1d1552] [.light_&]:[text-shadow:0_1px_0_rgb(255_255_255/0.9)]")}>{t("hub.daily.title")}</h2>
        <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3 max-md:flex-nowrap">
          <StreakDays days={d.days} />
          {d.streak > 0 && (
            <p className="flex items-center gap-1 pb-0.5 font-display text-xs font-bold uppercase italic leading-none text-white [.light_&]:text-[#1d1552]">
              <Flame className="h-4 w-4 text-[#ff9a1f]" aria-hidden />
              {t("hub.daily.streak", { n: d.streak })}
            </p>
          )}
        </div>
        <div className="mt-3">
          {d.dailyPlayed ? (
            <div className="space-y-1.5 rounded-lg bg-[#120f24]/60 px-3 py-2 [.light_&]:bg-white/80 [.light_&]:ring-1 [.light_&]:ring-[#d4c9ff]" data-testid="geo-daily-played">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <p className="whitespace-nowrap font-display text-sm font-bold italic text-[#ffd23c] [.light_&]:text-[#c2410c]">{d.dailyScore !== undefined ? t("hub.daily.scored", { score: fmt(d.dailyScore) }) : t("hub.played")}</p>
                {d.onDailyResult && (
                  <button type="button" onClick={d.onDailyResult} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-display text-[11px] font-bold uppercase italic tracking-wide text-white ring-1 ring-white/20 transition-colors hover:bg-white/20 [.light_&]:bg-[#4a3bb0] [.light_&]:ring-0" data-testid="geo-daily-result">
                    <Trophy className="h-3.5 w-3.5" aria-hidden />
                    {t("hub.result")}
                  </button>
                )}
              </div>
              <div className="[&>div]:justify-start [&>div]:text-white/75 [&_span]:text-white [.light_&]:[&>div]:text-[#4b4280] [.light_&]:[&_span]:text-[#1d1552]">
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
function Backdrop({ pattern }: { pattern: Pattern }) {
  const p = PATTERNS[pattern];
  const tile = p.size.includes("%") ? "no-repeat" : "repeat";
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
      <span className="absolute -right-[6%] -top-[30%] aspect-square h-[150%] rounded-full opacity-50 [.light_&]:opacity-35" style={{ background: `radial-gradient(closest-side, ${GLOW[pattern]}, transparent)` }} />
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
        className="pointer-events-none absolute -top-[12%] right-[4%] h-[94%] w-auto drop-shadow-[0_10px_10px_rgb(10_5_40/0.55)] [.light_&]:drop-shadow-[0_8px_10px_rgb(70_50_170/0.3)] transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:rotate-[-4deg] group-hover:scale-105 motion-reduce:transition-none"
      />
      <span className="relative block min-w-0 max-w-[58%] px-3.5 pt-3.5">
        <span className="block font-display text-[1.05rem] font-bold italic leading-[1.05] text-white [text-shadow:0_2px_0_rgb(18_10_60/0.6)] md:text-[clamp(0.95rem,1.1vw,1.45rem)] [:lang(en)_&]:capitalize [.light_&]:text-[#1d1552] [.light_&]:[text-shadow:0_1px_0_rgb(255_255_255/0.9)]">{title}</span>
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
      <WorldRise focus={focus} spots={d.dailyPlayed ? d.dailySpots : undefined} cheer={d.dailyPlayed} covered={d.covered} hopRef={trainer} className={`${LAYOUT} [--ah:8rem] [--gd:min(80vw,19.5rem)] [--gt:11rem] max-md:[--globe-floor:33rem] md:[--ah:clamp(8.5rem,26vh,15rem)] md:[--gd:min(44vw,74vh,calc(100vw-2*(var(--side)+var(--cw)+3rem)))] md:[--gt:max(13rem,40%)]`} />
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
          `pointer-events-none relative z-[1] flex h-full flex-col px-4 pt-3 [&_button]:pointer-events-auto [&_a]:pointer-events-auto ${LAYOUT} [--gap:clamp(0.45rem,0.6vw,0.85rem)]`,
          "md:grid md:grid-cols-[var(--cw)_1fr_var(--cw)] md:grid-rows-[1fr_auto_auto_1fr] md:gap-x-6",
          "md:px-[var(--side)] md:pb-[clamp(1rem,4vh,2.5rem)] md:pt-[clamp(0.75rem,3vh,2rem)]",
        )}
      >
        <div className="md:absolute md:left-1/2 md:top-[clamp(0.75rem,3vh,2rem)] md:-translate-x-1/2">
          <Title />
        </div>
        {/* Phone: the trainer and the whole world get this room, clear of every card. */}
        <div className="h-[28rem] shrink-0 md:hidden" aria-hidden />
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
