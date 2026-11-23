"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, Check, ChevronsRight, X } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import huntNs from "@/messages/hunt";
import { ExitButton, Notch, ScoreTracker } from "@/components/geo/GameShell";
import { GeoMap, type HuntMapLink, type HuntMapSpot, type MapPin } from "@/components/geo/GeoMap";
import type { HuntPokemonView } from "./HuntCard";
import { huntPinColor } from "./map-marks";

/** The most a round scores. */
export const HUNT_MAX_ROUND = 5000;

/** A real spot, as the reveal shows it (all in the page's language). */
export interface HuntRevealSpot extends MapPin {
  /** The region's name ("Kanto"); spots come in region by region in the order given. */
  region: string;
  /** The place ("Route 12"). */
  place: string;
  /** "Red/Blue". */
  game: string;
  /** "Super Rod", "Walking in tall grass", "Static encounter". */
  method: string;
}

/** A pin as scored: where it was, the spot it scored against, and its points. */
export interface HuntRevealPin {
  pin: MapPin;
  /** Index into `spots` of the nearest real spot. */
  spot: number;
  score: number;
}

export interface HuntRevealProps {
  region: GeoRegionInfo;
  pokemon: HuntPokemonView;
  spots: HuntRevealSpot[];
  /** The player's pins in order (pin 1 first); an empty list when time ran out with none down. */
  pins: HuntRevealPin[];
  /** The round's score (the pins' points together). */
  score: number;
  /** Regions it's found in, and how many of them a pin found. */
  regionsTotal: number;
  regionsFound: number;
  /** The most pins the round took (3 on the world for a Pokémon in more regions). */
  maxPins: number;
  /** One line of trivia, shown after the reveal. */
  fact?: string;
  /** The Pokémon's "where to find" section in the Pokédex. */
  dexHref: string;
  timedOut?: boolean;
  roundIndex: number;
  rounds: number;
  /** Every round's score, this one last. */
  scores: number[];
  modeLine: string;
  /** The last round: Next becomes See results. */
  done: boolean;
  onNext: () => void;
  onExit: () => void;
}

/** Seconds between one region's spots popping in and the next's. */
const REGION_STEP = 0.34;
/** The first region's spots wait this long for the camera. */
const FIRST_POP = 0.35;

/**
 * The reveal, PokéGuessr's round result for a Pokémon: the map frames every
 * real spot and they pop in region by region, each flag tagged with its game
 * and method; then each pin's dashed line draws to the spot it scored
 * against and the score counts up. About two seconds; a tap on the map,
 * Skip or Space shows it all at once (Space again is Next), and reduced
 * motion shows it all straight away. Beside the map (under it on a phone):
 * where it really is, region by region, with which pins found what.
 */
export function HuntReveal(p: HuntRevealProps) {
  const t = useT(huntNs);
  const g = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const reduced = useReducedMotion();
  const [skipped, setSkipped] = useState(false);
  const instant = reduced || skipped;

  // The regions in the order their spots come in, and when each pops.
  const order = useMemo(() => [...new Set(p.spots.map((s) => s.region))], [p.spots]);
  const foundSpots = useMemo(() => new Set(p.pins.map((x) => x.spot)), [p.pins]);
  const foundRegions = useMemo(() => new Set(p.pins.map((x) => p.spots[x.spot]?.region)), [p.pins, p.spots]);
  const regionDelay = (r: string) => (instant ? 0 : FIRST_POP + order.indexOf(r) * REGION_STEP);
  const linksAt = instant ? 0 : FIRST_POP + order.length * REGION_STEP + 0.1;
  const countAt = instant ? 0 : linksAt + 0.55;
  const totalMs = (countAt + 0.8) * 1000;

  const [running, setRunning] = useState(!reduced);
  useEffect(() => {
    if (instant) return setRunning(false);
    const id = window.setTimeout(() => setRunning(false), totalMs);
    return () => window.clearTimeout(id);
  }, [instant, totalMs]);
  const skip = () => {
    setSkipped(true);
    setRunning(false);
  };

  // Space (or Enter on the page) skips the sequence, then moves on.
  const live = useRef({ running, onNext: p.onNext });
  useEffect(() => {
    live.current = { running, onNext: p.onNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, input, textarea, select")) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
      e.preventDefault();
      if (live.current.running) skip();
      else live.current.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const spots: HuntMapSpot[] = p.spots.map((s, i) => ({ x: s.x, y: s.y, tag: t("reveal.method", { game: s.game, method: s.method }), delay: regionDelay(s.region) + (instant ? 0 : (i % 4) * 0.04), found: foundSpots.has(i) }));
  const links: HuntMapLink[] = p.pins.map((x, i) => ({ pin: x.pin, spot: x.spot, n: i + 1, delay: linksAt + i * 0.12 }));
  const shown = useCount(p.score, instant ? 0 : 800, countAt * 1000);
  const prev = p.scores.slice(0, -1);
  const found = p.regionsFound;
  const possible = Math.min(p.regionsTotal, p.maxPins);
  const headline = p.timedOut && !p.pins.length ? t("reveal.timeUp") : found === 0 ? t("reveal.foundNone") : found >= p.regionsTotal ? t("reveal.foundAll", { total: p.regionsTotal }) : p.regionsTotal > p.maxPins && found >= possible ? t("reveal.foundCapped", { found, max: possible }) : t("reveal.found", { found, total: p.regionsTotal });
  const after = (s: number) => ({ initial: instant ? false : { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: instant ? 0 : s, ease: [0.2, 0.8, 0.2, 1] as const } });

  return (
    <div className="relative flex h-full flex-col bg-[#0f0d1f] md:flex-row" data-testid="hunt-reveal" data-running={running ? "true" : undefined}>
      {/* Where it really is: region by region (beside the map; under it on a phone). */}
      <aside className="order-2 flex min-h-0 flex-col border-[#a99cff] bg-[#1e1a3f] text-white max-md:max-h-[34vh] max-md:border-t-4 md:order-none md:w-[clamp(15rem,22vw,20rem)] md:border-r-4" data-testid="hunt-spots">
        <div className="flex items-center gap-3 border-b border-white/10 p-3 md:p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already loaded */}
          <img src={p.pokemon.art} alt="" className="h-12 w-12 shrink-0 object-contain md:h-14 md:w-14" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold uppercase italic leading-tight">{p.pokemon.name}</p>
            {p.pokemon.form && <p className="truncate font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff8ab3]">{p.pokemon.form}</p>}
          </div>
        </div>
        <p className="hud-label px-3 pt-3 !text-[#c8bfff] md:px-4">{t("reveal.spots")}</p>
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-2 md:px-4">
          {order.map((r) => {
            const hit = foundRegions.has(r);
            return (
              <motion.li key={r} {...after(regionDelay(r))} className={cn("rounded-md border px-2.5 py-2", hit ? "border-[#4cbb17]/60 bg-[#4cbb17]/10" : "border-white/10 bg-black/20")} data-testid="hunt-spot-region" data-found={hit ? "true" : undefined}>
                <p className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide">
                  {hit ? <Check className="h-4 w-4 text-[#9be15d]" aria-hidden /> : <X className="h-4 w-4 text-white/40" aria-hidden />}
                  {t("reveal.spotsIn", { region: r })}
                  <span className="sr-only">{hit ? g("results.correct") : g("results.missed")}</span>
                </p>
                <ul className="mt-1 space-y-1">
                  {p.spots.map((s, i) =>
                    s.region !== r ? null : (
                      <li key={i} className="flex items-start gap-2 text-xs leading-snug">
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-white">{s.place}</span>
                          <span className="block text-white/65">{t("reveal.method", { game: s.game, method: s.method })}</span>
                        </span>
                        {p.pins.map((x, k) =>
                          x.spot === i ? (
                            <span key={k} className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-display text-[11px] font-bold text-white ring-1 ring-black/40" style={{ background: huntPinColor(k) }} title={t("reveal.pin", { n: k + 1 })}>
                              {k + 1}
                            </span>
                          ) : null
                        )}
                      </li>
                    )
                  )}
                </ul>
              </motion.li>
            );
          })}
        </ol>
      </aside>

      {/* The map: every spot, every pin, every line. A tap skips the sequence. */}
      <div className="relative order-1 min-h-0 flex-1 md:order-none" onPointerDown={running ? skip : undefined}>
        <div className="absolute inset-0 md:bottom-[6.75rem]">
          <GeoMap region={p.region} spots={spots} links={links} fill controls={!running} fit={{ delay: 0, duration: instant ? 0 : 700 }} />
        </div>
        <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
          <ExitButton onClick={p.onExit} />
        </div>
        <div className="geo-safe-tr absolute right-3 top-3 z-20 hidden lg:block">
          <ScoreTracker rounds={p.rounds} scores={[...prev, shown]} current={p.roundIndex} total={fmt(prev.reduce((a, b) => a + b, 0) + shown)} />
        </div>
        <Notch>
          <div className="text-center">
            <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">
              {g("round")} {p.roundIndex + 1}
            </div>
            <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{p.modeLine}</div>
          </div>
        </Notch>
        {running && (
          <button type="button" onClick={skip} className="absolute bottom-3 right-3 z-20 inline-flex h-9 items-center gap-1.5 rounded-md bg-black/60 px-3 font-display text-xs font-bold uppercase tracking-wider text-white backdrop-blur transition-colors hover:bg-black/80 md:bottom-[7.5rem]" data-testid="hunt-skip">
            {t("reveal.skip")}
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </button>
        )}

        {/* The bottom bar (desktop), PokéGuessr's: the score, the regions found and Next. */}
        <div className="absolute inset-x-0 bottom-0 z-20 hidden border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur md:block">
          <RevealBar {...p} shown={shown} headline={headline} after={after} countAt={countAt} instant={instant} t={t} fmt={fmt} />
        </div>
      </div>

      {/* Phone: the bar under the map, above the spots. */}
      <div className="order-1 shrink-0 border-t-4 border-[#a99cff] bg-[#1e1a3f] text-white md:hidden">
        <RevealBar {...p} shown={shown} headline={headline} after={after} countAt={countAt} instant={instant} t={t} fmt={fmt} />
      </div>
    </div>
  );
}

type HuntT = Translator<(typeof huntNs)["en"]>;

function RevealBar(p: HuntRevealProps & { shown: number; headline: string; after: (s: number) => object; countAt: number; instant: boolean; t: HuntT; fmt: (n: number) => string }) {
  const { t, fmt } = p;
  const verdict = p.score >= 4500 ? "perfect" : p.score >= 3500 ? "great" : p.score >= 2000 ? "good" : p.score > 0 ? "near" : "far";
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr] md:pb-3">
      <div className="min-w-0 text-center md:text-left">
        <p className="hud-label !text-[#c8bfff]">{t(`reveal.verdict.${verdict}`)}</p>
        <p className="geo-glow font-display text-4xl font-bold italic tabular-nums sm:text-5xl" data-testid="hunt-round-score">
          {fmt(p.shown)} <span className="text-lg not-italic text-white/60">{t("reveal.pts")}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="meter h-2 flex-1 !bg-black/40">
            <motion.div className="h-full bg-[#9be15d]" initial={{ width: 0 }} animate={{ width: `${(p.score / HUNT_MAX_ROUND) * 100}%` }} transition={{ duration: p.instant ? 0 : 0.8, delay: p.countAt, ease: "easeOut" }} />
          </div>
          <span className="font-pixel text-[9px] text-white/50">{fmt(HUNT_MAX_ROUND)}</span>
        </div>
      </div>

      <motion.div {...p.after(p.countAt)} className="flex min-w-0 flex-col items-center gap-1.5">
        <span className={cn("inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] px-4 py-1.5 font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg", p.regionsFound > 0 ? "bg-[#4cbb17]" : "bg-[#4a3f9e]")} data-testid="hunt-found-line">
          {p.headline}
        </span>
        {p.pins.length > 1 && (
          <p className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-white/75" data-testid="hunt-pin-scores">
            {p.pins.map((x, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: huntPinColor(i) }} aria-hidden />
                {t("reveal.pinScore", { n: i + 1, score: fmt(x.score) })}
              </span>
            ))}
          </p>
        )}
        {p.fact && (
          <p className="max-w-md text-center text-xs leading-snug text-[#c8bfff]" data-testid="hunt-fact">
            {p.fact}
          </p>
        )}
        <Link href={p.dexHref} target="_blank" className="inline-flex items-center gap-1 text-xs text-white/75 underline underline-offset-2 hover:text-white" data-testid="hunt-dex-link">
          <BookOpen className="h-3 w-3" aria-hidden />
          {t("reveal.dex")}
        </Link>
      </motion.div>

      <div className="flex flex-col items-center gap-1.5 md:items-end">
        <button
          type="button"
          onClick={p.onNext}
          data-testid="hunt-next"
          className="flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
        >
          {p.done ? t("reveal.summary") : t("reveal.next")} ▶
          <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline [@media(pointer:coarse)]:!hidden">{t("reveal.space")}</kbd>
        </button>
      </div>
    </div>
  );
}

/** Counts up to `value` over `ms` after `delay` ms (eased); straight there when `ms` is 0. */
function useCount(value: number, ms: number, delay: number): number {
  const [shown, setShown] = useState(ms ? 0 : value);
  useEffect(() => {
    if (!ms) return setShown(value);
    let raf = 0;
    let start = 0;
    const id = window.setTimeout(() => {
      const tick = (now: number) => {
        start ||= now;
        const k = Math.min(1, (now - start) / ms);
        setShown(Math.round(value * (1 - (1 - k) ** 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [value, ms, delay]);
  return shown;
}
