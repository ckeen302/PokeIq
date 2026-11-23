"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, Check, ChevronsRight, X } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import type { HuntReveal, HuntRoundPublic } from "@/lib/hunt/types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import huntNs from "@/messages/hunt";
import { ExitButton, Notch, ScoreTracker, usePhone } from "@/components/geo/GameShell";
import { GeoMap, type HuntMapLink, type HuntMapSpot } from "@/components/geo/GeoMap";
import { huntPinColor } from "./map-marks";
import { HUNT_ROUND_MAX, formKey, useHuntRegionName, verdictOf } from "./hunt-ui";

/** Seconds between one region's spots popping in and the next's. */
const REGION_STEP = 0.34;
/** The first region's spots wait this long for the camera. */
const FIRST_POP = 0.35;
/** The score counts up over this long (ms). */
const COUNT_MS = 800;

export interface HuntRevealPanelProps {
  reveal: HuntReveal;
  /** The round's score. */
  score: number;
  /** 0-based round index. */
  index: number;
  rounds: number;
  onNext: () => void;
  /** The last round: Next becomes See results. */
  last: boolean;
  /** The map that was played. With it, the panel draws the whole reveal screen (map, notch, tracker); without it, only the bottom bar. */
  region?: GeoRegionInfo;
  /** The round as it was shown (art, name, form). */
  round?: HuntRoundPublic;
  /** Every round's score so far, this one last (the score tracker). */
  scores?: number[];
  /** The line under the round number in the notch. */
  modeLine?: string;
  onExit?: () => void;
  timedOut?: boolean;
}

/**
 * The reveal, PokéGuessr's round result for a Pokémon. The map frames every
 * real spot and they pop in region by region, each flag tagged with its
 * game and method; then each pin's dashed line draws to the spot it scored
 * against and the score counts up, about two seconds in all. A tap on the
 * map, Skip, or Space shows it all at once (Space again is Next); reduced
 * motion shows it all straight away. Beside the map (under it on a phone):
 * the Pokémon and where it really is, region by region, with which pin
 * found what. The bottom bar: the score, "You found 2 of 3 regions", the
 * fact, the Pokédex link and Next.
 */
export function HuntRevealPanel(p: HuntRevealPanelProps) {
  const t = useT(huntNs);
  const g = useT(geoNs);
  const regionName = useHuntRegionName();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const reduced = useReducedMotion();
  const phone = usePhone();
  const [skipped, setSkipped] = useState(false);
  const instant = !!reduced || skipped;
  const { reveal } = p;

  // The regions in the order their spots come in, and when each pops.
  const order = useMemo(() => [...new Set(reveal.spots.map((s) => s.region))], [reveal.spots]);
  const foundSpots = useMemo(() => new Set(reveal.pins.filter((x) => x.found && x.spot !== null).map((x) => x.spot!)), [reveal.pins]);
  const foundRegions = useMemo(() => new Set(reveal.pins.filter((x) => x.found && x.region).map((x) => x.region!)), [reveal.pins]);
  const regionDelay = (r: string) => (instant ? 0 : FIRST_POP + (order as string[]).indexOf(r) * REGION_STEP);
  const linksAt = instant ? 0 : FIRST_POP + order.length * REGION_STEP + 0.1;
  const countAt = instant ? 0 : linksAt + 0.55;
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
    rootRef.current?.querySelector<HTMLElement>('[data-testid="hunt-next"]')?.focus({ preventScroll: true });
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
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
      e.preventDefault();
      if (live.current.running) skip();
      else live.current.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The map tags the spots the pins scored against, and the first spot of each region nobody found (the list has them all).
  const tagged = new Set<number>(reveal.pins.flatMap((x) => (x.spot === null ? [] : [x.spot])));
  for (const r of order) if (!reveal.pins.some((x) => x.spot !== null && reveal.spots[x.spot]?.region === r)) tagged.add(reveal.spots.findIndex((s) => s.region === r));
  const spots: HuntMapSpot[] = reveal.spots.map((s, i) => ({ x: s.pin[0], y: s.pin[1], mask: s.mask, tag: tagged.has(i) ? shortLabel(s.labels, t) : undefined, delay: regionDelay(s.region) + (instant ? 0 : (i % 4) * 0.04), found: foundSpots.has(i) }));
  const links: HuntMapLink[] = reveal.pins.flatMap((x, i) => (x.spot === null ? [] : [{ pin: x.pin, spot: x.spot, n: i + 1, delay: linksAt + i * 0.12 }]));
  const shown = useCount(p.score, instant ? 0 : COUNT_MS, countAt * 1000);
  const scores = p.scores ?? [p.score];
  const prev = scores.slice(0, -1);
  const headline =
    p.timedOut && !reveal.pins.length ? t("reveal.timeUp") : reveal.found === 0 ? t("reveal.foundNone") : reveal.found >= reveal.of && reveal.of === reveal.regions.length ? t("reveal.foundAll", { total: reveal.of }) : t("reveal.found", { found: reveal.found, total: reveal.of });
  const after = (s: number) => ({ initial: instant ? false : { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: instant ? 0 : s, ease: [0.2, 0.8, 0.2, 1] as const } });
  const bar = <RevealBar {...p} shown={shown} headline={headline} after={after} countAt={countAt} instant={instant} t={t} fmt={fmt} />;

  // Without the map: the bar alone (HuntGame draws the rest).
  if (!p.region) {
    return (
      <div ref={rootRef} className="border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white" data-testid="hunt-reveal">
        {bar}
        <SpotList {...{ reveal, order, foundRegions, regionDelay, after, regionName, t, g }} className="max-h-[30vh]" />
      </div>
    );
  }

  const form = p.round ? formKey(p.round.id) : null;
  const formTag = form && t.has(`forms.${form}`) ? t(`forms.${form}` as "forms.alola") : null;
  return (
    <div ref={rootRef} className={cn("relative flex h-full bg-[#0f0d1f]", phone ? "flex-col" : "flex-row")} data-testid="hunt-reveal" data-running={running ? "true" : undefined}>
      {/* The Pokémon and where it really is (beside the map; under it on a phone). */}
      <aside className={cn("flex min-h-0 flex-col border-[#a99cff] bg-[#1e1a3f] text-white", phone ? "order-3 max-h-[32vh] flex-1 border-t" : "w-[clamp(15rem,22vw,20rem)] border-r-4")}>
        {p.round && (
          <div className={cn("flex items-center gap-3 border-b border-white/10 p-4", phone && "hidden")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already loaded */}
            <img src={p.round.art} alt="" className="h-14 w-14 shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold uppercase italic leading-tight">{p.round.name}</p>
              {formTag && <p className="truncate font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff8ab3]">{formTag}</p>}
            </div>
          </div>
        )}
        <SpotList {...{ reveal, order, foundRegions, regionDelay, after, regionName, t, g }} className="flex-1" />
      </aside>

      {/* The map: every spot, every pin, every line. A tap skips the sequence. */}
      <div className={cn("relative min-h-0 flex-1", phone && "order-1")} onPointerDown={running ? skip : undefined}>
        <div className="absolute inset-0" style={phone ? undefined : { bottom: "6.75rem" }}>
          <GeoMap region={p.region} spots={spots} links={links} fill controls={false} fit={{ delay: 0, duration: instant ? 0 : 700 }} />
        </div>
        {p.onExit && (
          <div className="geo-safe-tl absolute left-3 top-3 z-20">
            <ExitButton onClick={p.onExit} />
          </div>
        )}
        <div className="geo-safe-tr absolute right-3 top-3 z-20 hidden lg:block">
          <ScoreTracker rounds={p.rounds} scores={[...prev, shown]} current={p.index} total={fmt(prev.reduce((a, b) => a + b, 0) + shown)} />
        </div>
        <Notch>
          <div className="text-center">
            <div className="whitespace-nowrap font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">
              {g("round")} {p.index + 1}
            </div>
            {p.modeLine && <div className="mt-0.5 whitespace-nowrap font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{p.modeLine}</div>}
          </div>
        </Notch>
        {running && (
          <button type="button" onClick={skip} className={cn("absolute right-3 z-20 inline-flex h-10 items-center gap-1.5 rounded-md bg-black/60 px-3.5 font-display text-xs font-bold uppercase tracking-wider text-white backdrop-blur transition-colors hover:bg-black/80", phone ? "bottom-3" : "bottom-[7.5rem]")} data-testid="hunt-skip">
            {t("reveal.skip")}
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </button>
        )}
        {/* The bottom bar (computers), PokéGuessr's: the score, the regions found and Next. */}
        {!phone && <div className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">{bar}</div>}
      </div>

      {/* Phones: the bar under the map, the spots under it. */}
      {phone && <div className="order-2 shrink-0 border-t-4 border-[#a99cff] bg-[#1e1a3f] text-white">{bar}</div>}
    </div>
  );
}

type HuntT = Translator<(typeof huntNs)["en"]>;

/**
 * A spot's tag on the map, kept short: its first label with the games cut to
 * the first two ("Red / Blue +3 · Poké Flute"), and "+1" when it has more labels.
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
type GeoT = Translator<(typeof geoNs)["en"]>;

/** Where it really is: a box per region (green where a pin found it), each place with its games and methods, and the pins that scored there. */
function SpotList({ reveal, order, foundRegions, regionDelay, after, regionName, t, g, className }: {
  reveal: HuntReveal;
  order: string[];
  foundRegions: Set<string>;
  regionDelay: (r: string) => number;
  after: (s: number) => object;
  regionName: (id: string) => string;
  t: HuntT;
  g: GeoT;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <p className="hud-label px-3 pt-3 !text-[#c8bfff] md:px-4">{t("reveal.spots")}</p>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-2 md:px-4">
        {order.map((r) => {
          const hit = foundRegions.has(r);
          return (
            <motion.li key={r} {...after(regionDelay(r))} className={cn("rounded-md border px-2.5 py-2", hit ? "border-[#4cbb17]/60 bg-[#4cbb17]/10" : "border-white/10 bg-black/20")} data-testid="hunt-spot-region" data-found={hit ? "true" : undefined}>
              <p className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide">
                {hit ? <Check className="h-4 w-4 text-[#9be15d]" aria-hidden /> : <X className="h-4 w-4 text-white/40" aria-hidden />}
                {regionName(r)}
                <span className="sr-only">{hit ? g("results.correct") : g("results.missed")}</span>
              </p>
              <ul className="mt-1 space-y-1.5">
                {reveal.spots.map((s, i) =>
                  s.region !== r ? null : (
                    <li key={i} className="flex items-start gap-2 text-xs leading-snug" data-testid="hunt-spot">
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-white">{s.name}</span>
                        {s.labels.map((l) => (
                          <span key={l} className="block text-white/70">
                            {l}
                          </span>
                        ))}
                      </span>
                      {reveal.pins.map((x, k) =>
                        x.spot === i ? (
                          <span key={k} className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-display text-[11px] font-bold text-white ring-1 ring-black/40", !x.found && "opacity-50")} style={{ background: huntPinColor(k) }} title={t("reveal.pin", { n: k + 1 })}>
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
    </div>
  );
}

function RevealBar(p: HuntRevealPanelProps & { shown: number; headline: string; after: (s: number) => object; countAt: number; instant: boolean; t: HuntT; fmt: (n: number) => string }) {
  const { t, fmt, reveal } = p;
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-2.5 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr] md:pb-3">
      <div className="min-w-0 text-center md:text-left">
        <p className="hud-label !text-[#c8bfff]">{t(`reveal.verdict.${verdictOf(p.score)}`)}</p>
        <p className="geo-glow font-display text-4xl font-bold italic tabular-nums sm:text-5xl" data-testid="hunt-round-score">
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
        <span className={cn("inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] px-4 py-1.5 text-center font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg", reveal.found > 0 ? "bg-[#4cbb17]" : "bg-[#4a3f9e]")} data-testid="hunt-found" role="status">
          {p.headline}
        </span>
        {reveal.pins.length > 1 && (
          <p className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-white/75" data-testid="hunt-pin-scores">
            {reveal.pins.map((x, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: huntPinColor(i) }} aria-hidden />
                {t("reveal.pinScore", { n: i + 1, score: fmt(x.score) })}
              </span>
            ))}
          </p>
        )}
        {reveal.fact && (
          <p className="max-w-md text-center text-xs leading-snug text-[#c8bfff]" data-testid="hunt-fact">
            {reveal.fact}
          </p>
        )}
        <Link href={reveal.dex} target="_blank" className="inline-flex items-center gap-1 text-xs text-white/75 underline underline-offset-2 hover:text-white" data-testid="hunt-dex-link">
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
          {p.last ? t("reveal.summary") : t("reveal.next")} ▶
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
