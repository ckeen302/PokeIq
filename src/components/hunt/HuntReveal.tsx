"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, ChevronsRight, MapPin as MapPinIcon, Sparkles } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import huntNs from "@/messages/hunt";
import { ExitButton, Notch, ScoreTracker, usePhone } from "@/components/geo/GameShell";
import { GeoMap, LINE_DRAW_MS, type HuntMapSpot, type MapPin, type RevealedRound } from "@/components/geo/GeoMap";
import { HUNT_ROUND_MAX, verdictOf } from "./hunt-ui";
import { useFormTag, type HuntPokemonView } from "./HuntCard";

/** Seconds between one region's spots popping in and the next's. */
const REGION_STEP = 0.3;
/** The other spots wait this long: the pin's line and its nearest spot come first. */
const FIRST_POP = LINE_DRAW_MS / 1000 + 0.15;
/** The score counts up over this long (ms). */
const COUNT_MS = 800;

/** A real spot, as the reveal shows it (all in the page's language). */
export interface HuntRevealSpot extends MapPin {
  /** The region's name ("Kanto"); spots come in region by region in the order given. */
  region: string;
  /** The place ("Route 12"). */
  place: string;
  /** Every "game · method" line ("Red / Blue · Super Rod"). */
  labels: string[];
  /** The place's area, shaded on the map. */
  mask: [number, number][];
}

/** The pin as scored: where it was, its nearest spot, and how far from it. */
export interface HuntRevealPin {
  pin: MapPin;
  /** Index into `spots` of the nearest spot. */
  spot: number;
  /** Town-map squares to that spot's area (0: spot on). */
  squares: number;
  /** What the pin earned, before hints. */
  score: number;
}

export interface HuntRevealProps {
  region: GeoRegionInfo;
  pokemon: HuntPokemonView;
  spots: HuntRevealSpot[];
  /** The pin; null when time ran out with none down. */
  pin: HuntRevealPin | null;
  /** The round's points, after hints. */
  score: number;
  /** What the hints cost (0: none taken). */
  hintCost: number;
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

/** The round's spots and pin as the map draws them: the pin's line to its nearest spot (PokéGuessr's flag), and every other spot. */
export function revealMarks(spots: HuntRevealSpot[], pin: HuntRevealPin | null, t: HuntT, delayOf: (i: number) => number = () => 0): { revealed: RevealedRound[]; others: HuntMapSpot[] } {
  const near = pin ? spots[pin.spot] : undefined;
  const revealed: RevealedRound[] = pin && near ? [{ guess: pin.pin, answer: { pin: [near.x, near.y], mask: near.mask } }] : [];
  const others: HuntMapSpot[] = spots.flatMap((s, i) => (pin && i === pin.spot ? [] : [{ x: s.x, y: s.y, mask: s.mask, tag: shortLabel(s.labels, t), delay: delayOf(i) }]));
  return { revealed, others };
}

/**
 * The reveal, PokéGuessr's round result for a Pokémon. The pin's dashed line draws to the nearest real
 * spot, whose flag and area come up as PokéGuessr's answer does; then every other real spot pops in,
 * region by region, each tagged with its games and method, and the score counts up, about two seconds
 * in all. A tap on the map, Skip or Space shows it all at once (Space again is Next); reduced motion
 * shows it all straight away. Beside the map (under it on a phone): where it really lives, region by
 * region, with the nearest spot marked. The bottom bar: the score, how far the pin was, what the hints
 * cost, the fact, the Pokédex link and Next.
 */
export function HuntReveal(p: HuntRevealProps) {
  const t = useT(huntNs);
  const g = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const reduced = useReducedMotion();
  const phone = usePhone();
  const [skipped, setSkipped] = useState(false);
  const instant = !!reduced || skipped;

  const order = useMemo(() => [...new Set(p.spots.map((s) => s.region))], [p.spots]);
  const regionDelay = (r: string) => (instant ? 0 : FIRST_POP + order.indexOf(r) * REGION_STEP);
  const countAt = instant ? 0 : FIRST_POP + order.length * REGION_STEP + 0.1;
  const totalMs = countAt * 1000 + COUNT_MS;

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
  // Once it's all shown, Next has the focus (Space and Enter then press it), unless the player is already somewhere else.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (running) return;
    const a = document.activeElement;
    if (a && a !== document.body && !rootRef.current?.contains(a)) return;
    // A frame later: Skip, which may have had the focus, is gone by then.
    const id = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-testid="hunt-next"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [running]);

  // Space or Enter: skip the sequence, then move on.
  const live = useRef({ running, onNext: p.onNext });
  useEffect(() => {
    live.current = { running, onNext: p.onNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, input, textarea, select")) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"]):not([inert])')) return;
      e.preventDefault();
      if (live.current.running) skip();
      else live.current.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { revealed, others } = revealMarks(p.spots, p.pin, t, (i) => regionDelay(p.spots[i].region) + (instant ? 0 : (i % 4) * 0.04));
  const shown = useCount(p.score, instant ? 0 : COUNT_MS, countAt * 1000);
  const prev = p.scores.slice(0, -1);
  const after = (s: number) => ({ initial: instant ? false : { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: instant ? 0 : s, ease: [0.2, 0.8, 0.2, 1] as const } });
  const bar = <RevealBar {...p} shown={shown} after={after} countAt={countAt} instant={instant} t={t} g={g} fmt={fmt} />;
  const formTag = useFormTag(p.pokemon);
  return (
    <div ref={rootRef} className={cn("relative flex h-full bg-[#0f0d1f]", phone ? "flex-col" : "flex-row")} data-testid="hunt-reveal" data-running={running ? "true" : undefined}>
      {/* The Pokémon and where it really is (beside the map; under it on a phone). */}
      <aside className={cn("flex min-h-0 flex-col border-[#a99cff] bg-[#1e1a3f] text-white", phone ? "order-3 max-h-[30vh] flex-1 border-t" : "w-[clamp(15rem,22vw,20rem)] border-r-4")}>
        <div className={cn("flex items-center gap-3 border-b border-white/10 p-4", phone && "hidden")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already loaded */}
          <img src={p.pokemon.art} alt="" className="h-14 w-14 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold uppercase italic leading-tight">{p.pokemon.name}</p>
            {formTag && <p className="truncate font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff8ab3]">{formTag}</p>}
          </div>
        </div>
        <SpotList spots={p.spots} nearest={p.pin?.spot ?? null} order={order} regionDelay={regionDelay} after={after} t={t} className="flex-1" />
      </aside>

      {/* The map: the pin, its line, every spot. A tap skips the sequence. */}
      <div className={cn("relative min-h-0 flex-1", phone && "order-1")} onPointerDown={running ? skip : undefined}>
        <div className="absolute inset-0" style={phone ? undefined : { bottom: "6.75rem" }}>
          <GeoMap region={p.region} revealed={revealed} spots={others} fill controls={false} fit={{ delay: instant ? 0 : LINE_DRAW_MS, duration: instant ? 0 : 700 }} />
        </div>
        <div className="geo-safe-tl absolute left-3 top-3 z-20">
          <ExitButton onClick={p.onExit} />
        </div>
        <div className="geo-safe-tr absolute right-3 top-3 z-20 hidden lg:block">
          <ScoreTracker rounds={p.rounds} scores={[...prev, shown]} current={p.roundIndex} total={fmt(prev.reduce((a, b) => a + b, 0) + shown)} />
        </div>
        <Notch>
          <div className="text-center">
            <div className="whitespace-nowrap font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">
              {g("roundN", { n: p.roundIndex + 1 })}
              <span className="text-white/50">/{p.rounds}</span>
            </div>
            <div className="mt-0.5 whitespace-nowrap font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{p.modeLine}</div>
          </div>
        </Notch>
        {running && (
          <button type="button" onClick={skip} className={cn("absolute right-3 z-20 inline-flex h-10 items-center gap-1.5 rounded-md bg-black/60 px-3.5 font-display text-xs font-bold uppercase tracking-wider text-white backdrop-blur transition-colors hover:bg-black/80", phone ? "bottom-3" : "bottom-[7.5rem]")} data-testid="hunt-skip">
            {t("reveal.skip")}
            <ChevronsRight className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        )}
        {/* The bottom bar (computers), PokéGuessr's: the score, how far the pin was and Next. */}
        {!phone && <div className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">{bar}</div>}
      </div>

      {/* Phones: the bar under the map, the spots under it. */}
      {phone && <div className="order-2 shrink-0 border-t-4 border-[#a99cff] bg-[#1e1a3f] text-white">{bar}</div>}
    </div>
  );
}

type HuntT = Translator<(typeof huntNs)["en"]>;
type GeoT = Translator<(typeof geoNs)["en"]>;

/**
 * A spot's tag on the map, kept short: its first label with the games cut to the first two
 * ("Red / Blue +3 · Grass"), and "+1" when it has more labels.
 */
export function shortLabel(labels: string[], t: HuntT): string {
  const first = labels[0] ?? "";
  const cut = first.lastIndexOf(" · ");
  const games = cut < 0 ? [] : first.slice(0, cut).split(" / ");
  const method = cut < 0 ? first : first.slice(cut + 3);
  const head = games.length > 2 ? `${games.slice(0, 2).join(" / ")} +${games.length - 2}` : games.join(" / ");
  const label = head ? `${head} · ${method}` : method;
  return labels.length > 1 ? t("reveal.moreLabels", { label, n: labels.length - 1 }) : label;
}

/** How far a pin was, as PokéGuessr says it ("Spot on", "2.4 squares away"). */
export function squaresLine(squares: number, g: GeoT): string {
  return squares === 0 ? g("results.spotOn") : g("results.squares", { n: squares, d: formatNumber(squares, g.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

/** Where it really lives: a box per region, each place with its games and methods, the pin's nearest spot marked. */
function SpotList({ spots, nearest, order, regionDelay, after, t, className }: {
  spots: HuntRevealSpot[];
  nearest: number | null;
  order: string[];
  regionDelay: (r: string) => number;
  after: (s: number) => object;
  t: HuntT;
  className?: string;
}) {
  const hit = nearest !== null ? spots[nearest]?.region : undefined;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <p className="hud-label px-3 pt-3 !text-[#c8bfff] md:px-4">{t("reveal.spots")}</p>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-2 md:px-4">
        {order.map((r) => (
          <motion.li key={r} {...after(regionDelay(r))} className={cn("rounded-md border px-2.5 py-2", r === hit ? "border-[#4cbb17]/60 bg-[#4cbb17]/10" : "border-white/10 bg-black/20")} data-testid="hunt-spot-region">
            <p className="font-display text-sm font-bold uppercase tracking-wide">{r}</p>
            <ul className="mt-1 space-y-1.5">
              {spots.map((s, i) =>
                s.region !== r ? null : (
                  <li key={i} className="flex items-start gap-2 text-xs leading-snug" data-testid="hunt-spot" data-nearest={i === nearest ? "true" : undefined}>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-white">{s.place}</span>
                      {s.labels.map((l) => (
                        <span key={l} className="block text-white/70">
                          {l}
                        </span>
                      ))}
                    </span>
                    {i === nearest && (
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3a8dde] text-white ring-1 ring-black/40" title={t("reveal.nearest")}>
                        <MapPinIcon className="h-3 w-3" aria-hidden />
                        <span className="sr-only">{t("reveal.nearest")}</span>
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function RevealBar(p: HuntRevealProps & { shown: number; after: (s: number) => object; countAt: number; instant: boolean; t: HuntT; g: GeoT; fmt: (n: number) => string }) {
  const { t, g, fmt } = p;
  const near = p.pin ? p.spots[p.pin.spot] : undefined;
  const good = !!p.pin && p.pin.score >= 2000;
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-2.5 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr] md:pb-3">
      <div className="min-w-0 text-center md:text-left">
        <p className="hud-label !text-[#c8bfff]">{t(`reveal.verdict.${verdictOf(p.score)}`)}</p>
        <p className="geo-glow whitespace-nowrap font-display text-4xl font-bold italic tabular-nums sm:text-5xl" data-testid="hunt-round-score">
          {fmt(p.shown)} <span className="text-lg not-italic text-white/60">{t("reveal.pts")}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="meter h-2 flex-1 !bg-black/40">
            <motion.div className="h-full bg-[#9be15d]" initial={{ width: 0 }} animate={{ width: `${(p.score / HUNT_ROUND_MAX) * 100}%` }} transition={{ duration: p.instant ? 0 : COUNT_MS / 1000, delay: p.countAt, ease: "easeOut" }} />
          </div>
          <span className="font-pixel text-[9px] text-white/50">{fmt(HUNT_ROUND_MAX)}</span>
        </div>
      </div>

      <motion.div {...p.after(p.countAt)} className="flex min-w-0 flex-col items-center gap-1.5">
        <span className={cn("inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] px-4 py-1.5 text-center font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg", good ? "bg-[#4cbb17]" : "bg-[#4a3f9e]")} data-testid="hunt-found-line" role="status">
          <MapPinIcon className="h-4 w-4 shrink-0" aria-hidden />
          {!p.pin ? t("reveal.timeUp") : squaresLine(p.pin.squares, g)}
        </span>
        {near && (
          <p className="max-w-md truncate text-center text-xs text-white/85" data-testid="hunt-nearest">
            <span className="text-[#c8bfff]">{t("reveal.nearest")}:</span> <span className="font-semibold">{near.place}</span> · {near.region}
          </p>
        )}
        {p.hintCost > 0 && (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#ffb3b3]" data-testid="hunt-hint-cost">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("reveal.hintCost", { cost: fmt(p.hintCost) })}
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
          className="flex h-12 w-full max-w-xs items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#4cbb17] px-4 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
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
