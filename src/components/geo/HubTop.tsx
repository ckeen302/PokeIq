"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "@/components/ui/Link";
import { CalendarRange, Check, Compass, Crosshair, Flame, MapPin, Pencil, Play, Swords, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "@/lib/account";
import { boardArtUrl } from "@/lib/pokemon/art";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { Avatar3D } from "@/components/trainer3d/Avatar3D";
import { TRAINER_PRESETS, presetTrainer } from "@/lib/trainer/presets";
import { BallIcon } from "@/components/duel/TierBadge";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoSolo from "@/messages/geo-solo";
import geoNs from "@/messages/geo";
import huntNs from "@/messages/hunt";
import avatarNs from "@/messages/avatar";
import creatorNs from "@/messages/trainer-creator";
import { HowToHelpButton } from "./GeoHowToButton";
import streakArt from "@/assets/guessr/region-streak.webp";
import worldBody from "@/assets/guessr/hub-world.webp";
import worldAir from "@/assets/guessr/hub-world-air.webp";
import huntMap from "@/assets/guessr/kanto.webp";
import duelArt from "@/assets/guessr/johto.webp";
import rankedArt from "@/assets/guessr/sinnoh.webp";
import partyArt from "@/assets/guessr/kalos.webp";

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
  dailyArt: string;
  dailyPlayed: boolean;
  dailyScore?: number;
  dailyResume: boolean;
  onDaily(): void;
  /** The finished Daily's result, when it's saved here. */
  onDailyResult?: () => void;
  dailyWarm?: Warm;
  weeklyNum: number | null;
  weeklyMap: string | null;
  weeklyArt: string | null;
  weeklyPlayed: boolean;
  weeklyScore?: number;
  weeklyLeft: string | null;
  weeklyResume: boolean;
  weeklyReady: boolean;
  onWeekly(): void;
  /** The finished Weekly's result, when it's saved here. */
  onWeeklyResult?: () => void;
  onWeeklyWarm?: () => void;
  classicMap: string;
  classicArt: string;
  classicBest?: number;
  soloOpen: boolean;
  onClassic(): void;
  regionStreakBest: number;
  onDuels(): void;
  onRanked(): void;
  onParty(): void;
  loading: boolean;
  /** The Daily's streak today (0: none) and the last seven days, oldest first. */
  streak: number;
  days: { date: string; played: boolean; today: boolean }[];
}

const CARD = "rounded-xl bg-gradient-to-r from-[#2d2766]/95 via-[#33297a]/95 to-[#3e3196]/95 ring-2 ring-[#8b7cff]/40 shadow-[0_8px_24px_rgb(0_0_0/0.45)] backdrop-blur";
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
@keyframes gh-drift { to { background-position: -1200px 0, -900px 0 } }
@keyframes gh-twinkle { 0%, 100% { opacity: .15; transform: scale(.6) } 50% { opacity: 1; transform: none } }
@keyframes gh-sheen { from { transform: translateX(-120%) skewX(-18deg) } to { transform: translateX(260%) skewX(-18deg) } }
.gh-rise { animation: gh-rise 1.4s cubic-bezier(.16,1,.3,1) both }
.gh-spin { animation: gh-spin 240s linear infinite }
.gh-unspin { animation: gh-unspin 240s linear infinite }
.gh-drop { animation: gh-drop 1.25s cubic-bezier(.3,0,.3,1) .55s both; transform-origin: 50% 90% }
.gh-shadow { animation: gh-shadow 1.25s ease-out .55s both }
.gh-in-s, .gh-in-e { animation: gh-in-u .7s cubic-bezier(.16,1,.3,1) both }
@media (min-width: 768px) { .gh-in-s { animation-name: gh-in-l } .gh-in-e { animation-name: gh-in-r } }
.gh-in-d { animation: gh-in-d .8s cubic-bezier(.16,1,.3,1) both }
.gh-fade { animation: gh-fade 1s ease-out both }
.gh-stars { animation: gh-drift 240s linear infinite }
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
        "relative mx-[calc(50%-50vw)] -mt-8 overflow-hidden bg-[#09081a] text-white max-md:-mt-6",
        "h-[calc(100svh-7rem-env(safe-area-inset-bottom))] min-h-[36rem] lg:h-[calc(100svh-4rem)]",
      )}
      data-testid="geo-home"
    >
      <style>{MOTION}</style>
      {/* Two layers of the starfield, drifting at different speeds (a slow parallax), and a few stars that twinkle. */}
      <div className="gh-stars pointer-events-none absolute inset-0 opacity-90 [background-image:url(/geo/hub-stars.svg),url(/geo/hub-stars.svg)] [background-position:0_0,300px_200px] [background-size:1200px_800px,900px_600px]" aria-hidden />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {TWINKLES.map((s, i) => (
          <span key={i} className="gh-twinkle absolute rounded-full bg-white" style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: `${s.d}s`, animationDuration: `${s.p}s` }} />
        ))}
      </div>
      {children}
      {/* The planet runs on under the fold: the page's own background takes over. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background" aria-hidden />
    </section>
  );
}

/**
 * The world rising from the bottom, turning slowly under the trainer, who drops onto it. Placed by CSS variables on
 * an ancestor: --gd the planet's diameter, --gt where its top is, --gx its centre across, --ah the trainer's height.
 */
function WorldRise({ className }: { className?: string }) {
  const account = useAccount();
  const a = account.user?.avatar ?? null;
  const ta = useT(avatarNs);
  const tc = useT(creatorNs);
  const names = useGeoNames();
  return (
    <div className={cn("pointer-events-none absolute inset-0 [--gx:50%]", className)}>
      <div
        className="absolute aspect-square -translate-x-1/2"
        style={{ left: "var(--gx)", width: `calc(var(--gd) / ${WORLD_FRAC})`, top: `calc(var(--gt) - var(--gd) * ${(1 / WORLD_FRAC - 1) / 2})` }}
        data-testid="geo-home-world"
      >
        <div className="gh-rise absolute inset-0">
          {/* The atmosphere; it doesn't turn (the light comes from up and to the left). */}
          <Image src={worldAir} alt="" priority unoptimized className="absolute inset-0 h-full w-full select-none" />
          <div className="gh-spin absolute inset-0">
            <Image src={worldBody} alt="" priority unoptimized className="absolute inset-0 h-full w-full select-none" />
            {WORLD_LABELS.map(([n, x, y]) => (
              <span key={n} className="absolute" style={{ left: `${x}%`, top: `${y}%` }}>
                <span className="gh-unspin block">
                  <span className="block -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] bg-[#120f24]/60 px-1.5 py-[3px] font-display text-[9px] font-bold uppercase leading-none tracking-[0.16em] text-white/90 ring-1 ring-white/20 backdrop-blur-[2px] md:text-[10px]">
                    {names.region(n)}
                  </span>
                </span>
              </span>
            ))}
          </div>
          {/* The light stays where it is while the world turns: lit up and to the left, night falling to the lower right. */}
          <div
            className="absolute rounded-full"
            style={{
              inset: `${((1 - WORLD_FRAC) / 2) * 100}%`,
              background: "radial-gradient(circle at 32% 22%, rgb(255 255 255 / .10), transparent 42%), radial-gradient(circle at 34% 26%, transparent 48%, rgb(8 10 40 / .38) 78%, rgb(6 6 24 / .72) 100%)",
            }}
          />
        </div>
      </div>
      {/* Their own 3D trainer, else a stand-in, the creator's first look (until everyone can make one). */}
      <div className="absolute -translate-x-1/2" style={{ left: "var(--gx)", top: "calc(var(--gt) - var(--ah) * 0.9)", width: "calc(var(--ah) * 0.8)", height: "var(--ah)" }}>
        <span className="gh-shadow absolute inset-x-[18%] bottom-[7%] h-[6%] rounded-[50%] bg-[#05040f]/60 blur-[5px]" aria-hidden />
        <div className="gh-drop absolute inset-0" data-testid="geo-home-trainer">
          <Avatar3D
            config={a?.trainer ?? STAND_IN}
            pose="idle"
            facing="front"
            label={a?.trainer ? tc("trainerOf", { name: account.user!.username }) : TRAINER_PRESETS[0].name}
          />
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
      <h1 className={cn(TITLE, "text-[2.1rem] tracking-tight [text-shadow:0_3px_0_#120f24,0_6px_18px_rgb(0_0_0/0.6)] md:text-[clamp(1.9rem,5.6vh,3.25rem)]")}>
        Poké<span className="text-primary">Guessr</span>
      </h1>
      <p className="mt-1.5 text-[clamp(0.8rem,2.2vh,1rem)] text-white/70 max-md:hidden">{t("hub.tagline")}</p>
    </div>
  );
}

/** The last seven days of the Daily: played ones ticked, today ringed. */
function StreakDays({ days }: { days: HubTopData["days"] }) {
  const t = useT(geoSolo);
  const fmt = new Intl.DateTimeFormat(t.locale, { weekday: "narrow", timeZone: "UTC" });
  return (
    <ol className="flex gap-1" aria-hidden>
      {days.map((d) => (
        <li key={d.date} className="flex flex-col items-center gap-1">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md md:h-[1.6rem] md:w-[1.6rem]",
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

function DailyCard({ d }: { d: HubTopData }) {
  const t = useT(geoSolo);
  const g = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  return (
    <div className={cn(CARD, "relative overflow-hidden p-3 md:p-3.5")} data-testid="geo-daily-card">
      {/* The Daily's own map, faint behind the card. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- the Daily tile's picture */}
      <img src={d.dailyArt} alt="" className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 object-cover opacity-30 [mask-image:linear-gradient(to_right,transparent,black_60%)]" />
      <div className="relative">
        <p className={cn(LABEL, "flex items-center gap-1.5 text-[#ffd23c]")}>
          <Compass className="h-3.5 w-3.5" aria-hidden />
          {t("hub.daily.label", { num: d.dailyNum ?? "" })}
          {d.dailyMap && <span className="text-[#c8bfff]">· {d.dailyMap}</span>}
        </p>
        <h2 className={cn(TITLE, "mt-1.5 text-[clamp(1.15rem,3.4vh,1.5rem)]")}>{t("hub.daily.title")}</h2>
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
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-sm font-bold italic text-[#ffd23c]">{d.dailyScore !== undefined ? t("hub.daily.scored", { score: fmt(d.dailyScore) }) : t("hub.played")}</p>
                {d.onDailyResult && (
                  <button type="button" onClick={d.onDailyResult} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-display text-[11px] font-bold uppercase italic tracking-wide text-white ring-1 ring-white/20 transition-colors hover:bg-white/20" data-testid="geo-daily-result">
                    <Trophy className="h-3.5 w-3.5" aria-hidden />
                    {t("hub.result")}
                  </button>
                )}
              </div>
              <div className="[&>div]:justify-start [&>div]:text-white/75">
                <NextDailyCountdown label={g("results.nextDaily")} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={cn(GREEN, "h-10 w-full text-base md:h-[clamp(2.4rem,6vh,2.9rem)] md:text-[clamp(0.95rem,2.6vh,1.15rem)]")}
              disabled={d.loading || !d.dailyNum}
              onClick={d.onDaily}
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

/** A mode as a tile: its picture, its name over it, where you stand in it. */
function ModeTile({
  art,
  art2x,
  icon,
  label,
  title,
  onClick,
  href,
  testId,
  disabled,
  button,
  children,
}: {
  art?: string | StaticImageData | null;
  /** MOCK: the picture at twice the size, for sharp screens. */
  art2x?: string;
  icon: React.ReactNode;
  label?: string;
  title: string;
  onClick?: () => void;
  href?: string;
  testId?: string;
  disabled?: boolean;
  button?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  children?: React.ReactNode;
}) {
  const pic = "object-cover opacity-75 transition-[opacity,transform] duration-500 group-hover:scale-105 group-hover:opacity-90";
  const body = (
    <>
      {art &&
        (typeof art === "object" ? (
          <Image src={art} alt="" fill sizes="200px" className={pic} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- the hub's own tile pictures
          <img src={art} srcSet={art2x ? `${art} 1x, ${art2x} 2x` : undefined} alt="" className={cn("absolute inset-0 h-full w-full", pic)} />
        ))}
      <span className="absolute inset-0 bg-gradient-to-t from-[#1b1640] via-[#1b1640]/75 to-[#1b1640]/5" aria-hidden />
      {children}
      <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-[#120f24]/75 ring-1 ring-white/15 backdrop-blur [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <span className="relative mt-auto block min-w-0 p-2.5 pt-0">
        {label && <span className={cn(LABEL, "mb-1 block truncate text-[9px] md:text-[10px]")}>{label}</span>}
        {/* The name's size follows the tile's width too, so its longest word ("Challenge") always fits whole. */}
        <span className={cn(TITLE, "block text-[min(clamp(0.85rem,2.2vh,1.05rem),12.5cqw)] leading-[1.05]")}>{title}</span>
      </span>
    </>
  );
  const cls = "gh-lift group relative flex h-full [container-type:inline-size] w-full flex-col overflow-hidden rounded-xl bg-[#2d2766] text-left ring-2 ring-[#8b7cff]/35 shadow-[0_8px_22px_rgb(0_0_0/0.45)] hover:ring-[#a99cff]/80 disabled:cursor-default disabled:hover:ring-[#8b7cff]/35";
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


/** Where each single-player tile sits in the wide layout's grid (a 2 × 2 under the Daily). */
const TILE_AT = ["md:col-start-1 md:row-start-4", "md:col-start-2 md:row-start-4", "md:col-start-1 md:row-start-5", "md:col-start-2 md:row-start-5"];
/** A mode's slot: a card in the phone's row along the bottom, a cell of its column wider. */
const SLOT = "h-[7.25rem] w-[8.75rem] shrink-0 snap-start md:h-[clamp(6rem,14vh,7.75rem)] md:w-auto";

export function HubTop({ d }: { d: HubTopData }) {
  const t = useT(geoSolo);
  const h = useT(huntNs);
  const delay = (i: number) => ({ animationDelay: `${0.15 + i * 0.08}s` });
  // MOCK: ?mp=A|B|C swaps the multiplayer tiles' pictures for a mock direction's.
  const [mp, setMp] = useState<string | null>(null);
  useEffect(() => setMp(new URLSearchParams(window.location.search).get("mp")?.toUpperCase() ?? null), []);
  const mock = (mode: string) => (mp && /^[ABC]$/.test(mp) ? { art: `/mock-mp/${mp}-${mode}.webp`, art2x: `/mock-mp/${mp}-${mode}@2x.webp` } : null);

  const tiles = [
    <div key="classic" data-testid="geo-solo-card">
      <ModeTile
        art={d.classicArt}
        icon={<MapPin className="text-[#a99cff]" />}
        label={t("hub.solo.label", { map: d.classicMap })}
        title={t("hub.solo.title")}
        onClick={d.onClassic}
        button={{ "aria-expanded": d.soloOpen, "aria-controls": "solo" }}
        testId="geo-solo-setup"
      />
    </div>,
    <div key="weekly" data-testid="geo-weekly-card">
      <ModeTile
        art={d.weeklyArt}
        icon={<CalendarRange className="text-[#9be15d]" />}
        title={t("hub.weekly.title")}
        // Played: the tile shows its result (when it's saved here); else it starts this week's, or picks it up.
        onClick={d.weeklyPlayed ? d.onWeeklyResult : d.onWeekly}
        disabled={d.weeklyPlayed ? !d.onWeeklyResult : !d.weeklyReady || d.loading}
        button={d.weeklyPlayed ? undefined : { onPointerEnter: d.onWeeklyWarm }}
        testId={d.weeklyPlayed ? (d.onWeeklyResult ? "geo-weekly-result" : "geo-weekly-played") : "geo-weekly-play"}
      />
    </div>,
    <div key="streak" data-testid="region-streak-card">
      <ModeTile
        art={streakArt}
        icon={<Flame className="text-[#ff9a1f]" />}
        label={t("hub.play.eyebrow")}
        title={t("regionStreak.label")}
        href="/pokeguessr/streak"
        testId="region-streak-link"
      />
    </div>,
    // Pokémon Hunt: a Pokémon on a map (Hunt's question: where would you catch it?).
    <div key="hunt">
      <ModeTile art={huntMap} icon={<Crosshair className="text-primary" />} label={h("tile.label")} title={h("tile.title")} href="/pokeguessr/hunt" testId="hunt-hub-entry">
        {/* eslint-disable-next-line @next/next/no-img-element -- static board art */}
        <img src={boardArtUrl(143)} alt="" aria-hidden className="absolute -right-[4%] -top-[3%] h-[60%] w-auto object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/0.55)] transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-105" />
      </ModeTile>
    </div>,
  ];
  const versus = [
    { icon: <Swords className="text-[#a99cff]" />, title: t("hub.multi.duels"), label: t("hub.multi.duelsLabel", { map: d.classicMap }), art: duelArt as string | StaticImageData, ...mock("duel"), onClick: d.onDuels, testId: "geo-home-duels" },
    { icon: <BallIcon tier="ultra" />, title: t("hub.multi.ranked"), label: t("hub.multi.rankedLabel"), art: rankedArt as string | StaticImageData, ...mock("ranked"), onClick: d.onRanked, testId: "geo-home-ranked" },
    // The party's label without its size ("Friends · up to 16"): the blurb says who it's for.
    { icon: <Users className="text-[#ff8fb3]" />, title: t("hub.multi.party"), label: t("hub.multi.partyLabel").split(/ · |・/)[0], art: partyArt as string | StaticImageData, ...mock("party"), onClick: d.onParty, testId: "geo-home-party" },
  ];

  return (
    <Space>
      <WorldRise className="[--ah:9rem] [--gd:min(98vw,30rem)] [--gt:calc(100%-20rem)] md:[--ah:clamp(8.5rem,26vh,15rem)] md:[--gd:min(44vw,74vh)] md:[--gt:max(13rem,40%)]" />
      <HowToHelpButton className="gh-fade absolute right-2 top-2 z-10 text-white max-md:scale-90 md:right-5 md:top-4" />

      {/*
        Phone: a column (the title, the Daily, then every other mode in a row along the bottom). Wider: a grid, the
        Daily and the single-player 2 × 2 down the left, the world in the middle, multiplayer down the right; the
        bottom row's wrapper steps aside (display: contents) so its cards are the grid's own.
      */}
      <div
        className={cn(
          "relative z-[1] flex h-full flex-col px-4 pt-3 [--cw:clamp(15.5rem,21vw,18.5rem)] [--gap:clamp(0.4rem,1.2vh,0.65rem)]",
          "md:grid md:grid-cols-[calc((var(--cw)-var(--gap))/2)_calc((var(--cw)-var(--gap))/2)_1fr_var(--cw)] md:grid-rows-[1fr_auto_auto_auto_auto_1fr] md:gap-[var(--gap)]",
          "md:px-[max(1rem,calc(50vw-42rem))] md:pb-[clamp(1rem,4vh,2.5rem)] md:pt-[clamp(0.75rem,3vh,2rem)]",
        )}
      >
        <div className="md:absolute md:left-1/2 md:top-[clamp(0.75rem,3vh,2rem)] md:-translate-x-1/2">
          <Title />
        </div>
        <div className="gh-in-s mt-3 md:col-span-2 md:col-start-1 md:row-start-2 md:mt-0" style={delay(1)}>
          <DailyCard d={d} />
        </div>
        <p className={cn(LABEL, "gh-in-s mt-1 px-0.5 max-md:hidden md:col-span-2 md:col-start-1 md:row-start-3")} style={delay(2)}>
          {t("hub.play.eyebrow")}
        </p>
        <div className="-mx-4 mb-4 mt-auto flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:contents">
          {tiles.map((tile, i) => (
            <div key={i} className={cn("gh-in-s [&>div]:h-full", SLOT, TILE_AT[i])} style={delay(3 + i)}>
              {tile}
            </div>
          ))}
          <div className="contents md:col-start-4 md:row-[1/-1] md:flex md:flex-col md:justify-center md:gap-[var(--gap)]">
            <p className={cn(LABEL, "gh-in-e px-0.5 max-md:hidden")} style={delay(1)}>
              {t("hub.multi.title")}
            </p>
            <div className="contents md:grid md:grid-cols-2 md:gap-[var(--gap)]">
              {versus.map((v, i) => (
                <div key={v.testId} className={cn("gh-in-e [&>button]:h-full", SLOT, i === 2 && "md:col-span-2")} style={delay(2 + i)}>
                  <ModeTile art={v.art} art2x={"art2x" in v ? v.art2x : undefined} icon={v.icon} label={v.label} title={v.title} onClick={v.onClick} testId={v.testId} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Space>
  );
}
