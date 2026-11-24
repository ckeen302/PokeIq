"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Check, Crown, Menu, Send, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { shareOrCopy } from "@/lib/share";
import { useProgress } from "@/lib/progress";
import { isCleanName } from "@/lib/name-filter";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import shareNs from "@/messages/share";
import communityNs from "@/messages/community";
import { ExitButton, GameShell, Notch, usePhone } from "./GameShell";

/**
 * The end of a game, GeoGuessr's: the whole map behind everything, dimmed and
 * blurred, every round's pins and lines on it; the score counting up from 0 over
 * a bar split into the rounds, with a marker at the score; then the rows (what
 * the game earned, sharing, the leaderboard) coming in one after another; and,
 * bottom centre, BREAKDOWN and NEXT. BREAKDOWN (or B) clears the dim and the
 * panel away to the map itself, with the round tracker top right; again, it
 * comes back. NEXT (or Space) goes on; Escape and the corner X leave.
 * Under reduced motion everything is in place at once.
 */

/** The count-up, and the bar filling with it (ms, eased out). */
export const END_COUNT_MS = 1200;
/** The first row comes in this long after the end screen (s), the next ones this far apart. */
const ROWS_AT = 1.3;
const ROW_STEP = 0.2;
const EASE = [0.2, 0.8, 0.2, 1] as const;

type View = "summary" | "breakdown";

/** The breakdown's tracker along the top and its buttons along the bottom (px): the map frames the pins between them. */
export const END_MAP_PAD = { top: 90, bottom: 130 };
/** The same with a round picked: its card sits under the tracker too. */
export const END_MAP_PAD_PICKED = { top: 170, bottom: 130 };

const RowClock = createContext<{ reduced: boolean; start: number }>({ reduced: true, start: 0 });

/**
 * A row under the score. It comes in after the count-up, `order` steps after the first; one whose
 * data arrives late (an achievement read from the server) comes in when it's there.
 */
export function EndRow({ order, className, children, testId }: { order: number; className?: string; children: React.ReactNode; testId?: string }) {
  const { reduced, start } = useContext(RowClock);
  const [delay] = useState(() => (reduced ? 0 : Math.max(0, ROWS_AT + order * ROW_STEP - (performance.now() - start) / 1000)));
  return (
    <motion.div
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: EASE, layout: { duration: 0.25, ease: EASE } }}
      className={cn("flex w-full justify-center", className)}
      data-testid={testId}
    >
      {children}
    </motion.div>
  );
}

/** The eased share of the count-up done (0 to 1); 1 at once under reduced motion. */
function useCountUp(ms: number, reduced: boolean): number {
  const [e, setE] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return setE(1);
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      const k = Math.min(1, (now - start) / ms);
      setE(1 - (1 - k) ** 3);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms, reduced]);
  return e;
}

export interface EndScore {
  value: number;
  /** The most the game could score (rounds × 5,000); none for a streak, which has no bar. */
  max?: number;
  /** The bar's segments: one per round. */
  segments?: number;
  /** "Your score", "Your streak". */
  label: string;
  /** Under the number: "of 25,000 points", "in a row". */
  unit: string;
  /** A friend's score on the bar (a challenge): their marker under it. */
  rival?: { value: number; name: string };
}

/**
 * GeoGuessr's score: the label, the number counting up, "of 25,000 points", and the bar filling in step with a
 * marker riding it. On a computer the number sits over the marker (kept on screen), as GeoGuessr's does.
 */
function ScoreBlock({ score, reduced, follow }: { score: EndScore; reduced: boolean; follow: boolean }) {
  const t = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const e = useCountUp(END_COUNT_MS, reduced);
  const { value, max, segments = 5, rival } = score;
  const shown = Math.round(value * e);
  const share = max ? Math.min(1, (value * e) / max) : 0;
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ bar: 0, head: 0, room: 0 });
  useLayoutEffect(() => {
    const bar = barRef.current;
    const head = headRef.current;
    if (!head) return;
    const measure = () => setSize({ bar: bar?.offsetWidth ?? 0, head: head.offsetWidth, room: window.innerWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    if (bar) ro.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  // Over the marker, but never off the screen (the column is centred in it).
  const reach = Math.max(0, (size.room - size.head) / 2 - 16);
  const shift = follow && max && size.bar ? Math.max(-reach, Math.min(reach, (share - 0.5) * size.bar)) : 0;

  return (
    <div className="flex w-full flex-col items-center" data-testid="geo-end-score">
      <div ref={headRef} className="flex flex-col items-center text-center will-change-transform" style={{ transform: `translateX(${shift}px)` }}>
        <p className="font-display text-[clamp(0.8rem,2.2vh,1.05rem)] font-bold uppercase italic leading-none tracking-[0.08em] text-[#c8bfff]">{score.label}</p>
        <p
          className="mt-[0.4vh] font-display text-[clamp(3rem,11.5vh,7rem)] font-bold italic leading-[0.95] tabular-nums text-[#ffd23c] [text-shadow:0_0.05em_0_#b45a00,0_0.09em_0_#120f24,0_0.12em_0.4em_rgb(0_0_0/0.55)]"
          data-testid="geo-results-total"
          data-value={value}
        >
          {fmt(shown)}
        </p>
        <p className="mt-[0.6vh] font-display text-[clamp(0.95rem,2.9vh,1.4rem)] font-bold uppercase italic leading-none tracking-[0.04em] text-white [text-shadow:0_2px_0_#120f24]">{score.unit}</p>
      </div>

      {max ? (
        <div className={cn("relative mt-[clamp(0.85rem,2.6vh,1.6rem)] w-[min(100%,max(21rem,41vw),44rem)]", rival && "mb-6")} data-testid="geo-end-bar">
          {/* The marker rides the bar's end. */}
          <span
            className="absolute bottom-full mb-[0.35rem] h-0 w-0 -translate-x-1/2 border-x-[0.5rem] border-t-[0.6rem] border-x-transparent border-t-white drop-shadow-[0_2px_2px_rgb(0_0_0/0.6)]"
            style={{ left: `${share * 100}%` }}
            data-testid="geo-end-marker"
            aria-hidden
          />
          <div
            ref={barRef}
            className="relative h-[clamp(1rem,3.4vh,1.45rem)] overflow-hidden rounded-[0.55rem] bg-[#1e1a3f] shadow-[inset_0_2px_6px_rgb(0_0_0/0.55),0_4px_14px_rgb(0_0_0/0.35)] ring-2 ring-[#5a4fb8]/80"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={`${fmt(value)} / ${fmt(max)}`}
            aria-label={score.label}
          >
            <span
              className="absolute inset-y-[3px] left-[3px] rounded-[0.35rem] bg-gradient-to-b from-[#ffd23c] to-[#ff9a1f] shadow-[inset_0_-3px_0_rgb(0_0_0/0.18),inset_0_2px_0_rgb(255_255_255/0.35)]"
              style={{ width: share > 0 ? `max(0.5rem, calc(${share * 100}% - 6px))` : 0 }}
              data-testid="geo-end-fill"
            />
            {Array.from({ length: Math.max(0, segments - 1) }, (_, i) => (
              <span key={i} className="absolute inset-y-0 w-[2px] -skew-x-[20deg] bg-[#120f24]/45" style={{ left: `${((i + 1) / segments) * 100}%` }} aria-hidden />
            ))}
          </div>
          <div className="mt-[0.5vh] flex justify-between font-display text-[clamp(0.7rem,1.9vh,0.85rem)] font-semibold italic text-white/75" aria-hidden>
            <span>{t("end.pts", { n: fmt(0) })}</span>
            <span>{t("end.pts", { n: fmt(max) })}</span>
          </div>
          {/* A friend's score (a challenge): a marker under the bar, their name and score under the labels. */}
          {rival && (
            <span
              className="absolute top-[calc(100%-1.4rem)] flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${Math.min(1, rival.value / max) * 100}%` }}
              data-testid="geo-end-rival"
            >
              <span className="h-0 w-0 border-x-[0.4rem] border-b-[0.5rem] border-x-transparent border-b-[#a99cff]" aria-hidden />
              <span className="mt-[1.1rem] max-w-[9rem] truncate rounded-full bg-[#1e1a3f] px-2 py-0.5 font-display text-[11px] font-bold uppercase italic text-[#c8bfff] ring-1 ring-[#a99cff]/60">
                {rival.name} · {fmt(rival.value)}
              </span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A cell of the breakdown's round tracker. */
export interface TrackerCell {
  /** The cell's top: the round's number in its tag (or a Pokémon's art). */
  top: React.ReactNode;
  /** Its score (or a tick or a cross). */
  value: React.ReactNode;
  /** Under it, a friend's score on the same round (a challenge). */
  sub?: React.ReactNode;
  /** The best and worst rounds are lit; a missed streak round is too. */
  tone?: "best" | "worst";
  /** "Round 2: 4,512", for the button. */
  label: string;
}

/**
 * GeoGuessr's round tracker for the breakdown, top right: a vertical "Round", each round's number and
 * score, and the total. A round picked flies the map to it; picked again, back to every round.
 */
export function EndTracker({ cells, total, totalSub, focus, onFocus, perRow = 5, wide }: {
  cells: TrackerCell[];
  total: string;
  /** Under the total, a friend's (a challenge). */
  totalSub?: React.ReactNode;
  focus: number | null;
  onFocus: (i: number | null) => void;
  perRow?: number;
  wide?: boolean;
}) {
  const t = useT(geoNs);
  const phone = usePhone();
  const cols = Math.min(cells.length, phone ? 5 : perRow);
  return (
    <div className="flex max-w-full items-stretch overflow-hidden rounded-xl bg-[#1e1a3f]/95 text-white shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-2 ring-[#5a4fb8]/70 backdrop-blur" data-testid="geo-end-tracker" role="group" aria-label={t("results.rounds")}>
      <span className="flex w-5 shrink-0 rotate-180 items-center justify-center bg-[#6c5ce7]/35 font-display text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-[#c8bfff] [writing-mode:vertical-rl] md:w-6 md:text-[10px]" aria-hidden>
        {t("round")}
      </span>
      <ol className="grid max-h-[40vh] gap-1 overflow-y-auto p-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => {
          const on = focus === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onFocus(on ? null : i)}
                aria-pressed={on}
                aria-label={c.label}
                title={c.label}
                data-testid={`geo-end-round-${i + 1}`}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 transition-colors",
                  wide ? "w-[3.1rem] xl:w-[3.75rem]" : "w-[2.45rem] md:w-[2.75rem] xl:w-[3.4rem]",
                  on ? "bg-[#ffd23c]/20 ring-2 ring-[#ffd23c]" : "hover:bg-white/10",
                  !on && c.tone === "best" && "bg-[#4cbb17]/15 ring-1 ring-[#4cbb17]/60",
                  !on && c.tone === "worst" && "bg-[#ff5a5a]/12 ring-1 ring-[#ff5a5a]/50"
                )}
              >
                <span className="relative">
                  {c.top}
                  {c.tone === "best" && <Crown className="absolute -right-2 -top-1.5 h-3 w-3 text-[#9be15d]" aria-hidden />}
                </span>
                <span className="font-display text-[12px] font-bold leading-none tabular-nums md:text-[13px] xl:text-[15px]">{c.value}</span>
                {c.sub !== undefined && <span className="font-display text-[10px] font-semibold leading-none tabular-nums text-[#a99cff] md:text-[11px]">{c.sub}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <span className="flex min-w-[3.6rem] shrink-0 flex-col items-center justify-center border-l border-white/10 px-2 md:min-w-[4.25rem] xl:min-w-[5rem] xl:px-3">
        <span className="font-display text-[10px] font-bold uppercase italic leading-none tracking-[0.14em] text-[#c8bfff]">{t("scoreTotal")}</span>
        <span className="mt-1 font-display text-sm font-bold italic leading-none tabular-nums text-[#ffd23c] md:text-base xl:text-xl" data-testid="geo-end-tracker-total">
          {total}
        </span>
        {totalSub !== undefined && <span className="mt-1 max-w-[5rem] truncate font-display text-[10px] font-semibold leading-none tabular-nums text-[#a99cff] md:text-[11px]">{totalSub}</span>}
      </span>
    </div>
  );
}

/** A round's number in a little map-pin tag, the tracker's top. */
export function RoundTag({ n, tone }: { n: number; tone?: "best" | "worst" }) {
  return (
    <span
      className={cn(
        "flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full rounded-br-[3px] px-1 font-display text-[10px] font-bold leading-none text-white shadow-inner md:h-[1.35rem] md:min-w-[1.35rem] md:text-[11px]",
        tone === "best" ? "bg-[#4cbb17]" : tone === "worst" ? "bg-[#e5484d]" : "bg-[#6c5ce7]"
      )}
      aria-hidden
    >
      {n}
    </span>
  );
}

export function EndScreen({
  map,
  score,
  title,
  mode,
  children,
  tracker,
  aside,
  legend,
  onNext,
  onExit,
  exitLabel,
  testId = "geo-results",
  nextTestId = "geo-results-again",
}: {
  /** The game's map, filling the screen: every round's pins and lines. */
  map: React.ReactNode;
  score: EndScore;
  /** The notch: "Survey complete", and the map and mode under it. */
  title: string;
  mode: string;
  /** The rows under the score (EndRow each). */
  children?: React.ReactNode;
  /** The breakdown's round tracker (EndTracker). */
  tracker: React.ReactNode;
  /** The breakdown's extras under the tracker: the picked round, the crowd map. */
  aside?: React.ReactNode;
  /** The breakdown's key to the map's colours, bottom left (computers). */
  legend?: React.ReactNode;
  onNext: () => void;
  onExit: () => void;
  /** The corner X's name (default: back to PokéGuessr). */
  exitLabel?: string;
  testId?: string;
  nextTestId?: string;
}) {
  const t = useT(geoNs);
  const reduced = !!useReducedMotion();
  const phone = usePhone();
  const [view, setView] = useState<View>("summary");
  const [clock] = useState(() => ({ reduced, start: typeof performance === "undefined" ? 0 : performance.now() }));
  const breakdown = view === "breakdown";
  const toggle = () => setView((v) => (v === "summary" ? "breakdown" : "summary"));

  // Space (or Enter) is NEXT, B the breakdown. A field being typed in keeps its keys; so does a button or link reached
  // with the keyboard (it has the focus ring). The first moment is ignored, so the key that ended the last round can't skip this.
  const keys = useRef({ onNext, toggle });
  keys.current = { onNext, toggle };
  useEffect(() => {
    const born = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"]):not([inert])')) return;
      const keyboardFocus = !!el?.closest("button, a") && el.matches(":focus-visible");
      if (e.key === " " || e.key === "Enter") {
        if (keyboardFocus) return;
        e.preventDefault();
        if (performance.now() - born > 400) keys.current.onNext();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        keys.current.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fade = { duration: reduced ? 0 : 0.32, ease: EASE };
  return (
    <GameShell onExit={onExit}>
      {() => (
        <div
          className="dark-scope relative h-full overflow-hidden text-white [--end-bar:calc(7rem+env(safe-area-inset-bottom))] md:[--end-bar:calc(clamp(6rem,17vh,8.5rem)+env(safe-area-inset-bottom))]"
          data-testid={testId}
          data-view={view}
        >
          {/* The map: under the dim on the end screen, the breakdown itself. Its zoom buttons sit under the corner X. */}
          <div
            className={cn(
              "absolute inset-0 [&_[data-map-controls]]:left-3 [&_[data-map-controls]]:right-auto [&_[data-map-controls]]:top-[calc(env(safe-area-inset-top)+3.75rem)]",
              !breakdown && "[&_[data-map-controls]]:hidden"
            )}
            data-testid="geo-end-map"
          >
            {map}
          </div>
          {/* The dim and the blur over it, which BREAKDOWN takes away. */}
          <div
            className={cn(
              "absolute inset-0 z-[5] bg-[radial-gradient(ellipse_at_center,rgb(15_13_31/0.5),rgb(15_13_31/0.78))] backdrop-blur-[3px] transition-opacity duration-500 ease-out",
              breakdown ? "pointer-events-none opacity-0" : "opacity-100"
            )}
            data-testid="geo-end-dim"
            aria-hidden
          />
          {/* The breakdown's foot: a shade under the buttons, so they read over a bright map. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-[calc(var(--end-bar)+3rem)] bg-gradient-to-t from-[#0f0d1f]/85 via-[#0f0d1f]/45 to-transparent transition-opacity duration-500",
              breakdown ? "opacity-100" : "opacity-0"
            )}
            aria-hidden
          />

          <div className="geo-safe-tl absolute left-3 top-3 z-30">
            <ExitButton onClick={onExit} label={exitLabel} />
          </div>
          {/* The notch: what was played. The breakdown's tracker takes the top instead, as GeoGuessr's does. */}
          {!breakdown && (
            <Notch>
              <div className="min-w-0 text-center">
                <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{title}</div>
                <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]" data-testid="geo-end-mode">
                  {mode}
                </div>
              </div>
            </Notch>
          )}

          {/* The end screen: the score, then the rows. Kept while the breakdown is up (a name being typed stays). */}
          <motion.div
            className="absolute inset-x-0 z-20 overflow-y-auto overscroll-contain"
            style={{ top: "calc(env(safe-area-inset-top) + 3.9rem)", bottom: "var(--end-bar)" }}
            initial={false}
            animate={breakdown ? { opacity: 0, y: 24, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
            transition={fade}
            inert={breakdown}
            aria-hidden={breakdown || undefined}
            data-testid="geo-end-panel"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col items-center justify-center gap-[clamp(0.45rem,1.6vh,1.1rem)] px-4 py-2">
              <ScoreBlock score={score} reduced={reduced} follow={!phone} />
              <RowClock.Provider value={clock}>{children}</RowClock.Provider>
            </div>
          </motion.div>

          {/* The breakdown: the tracker top right, and what's picked under it. */}
          <AnimatePresence>
            {breakdown && (
              <motion.div
                key="tracker"
                className="geo-safe-tr absolute right-3 top-3 z-20 flex max-w-[calc(100%-4.5rem)] flex-col items-end gap-2"
                initial={reduced ? false : { opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -12 }}
                transition={fade}
                data-testid="geo-breakdown"
              >
                {tracker}
                {aside}
              </motion.div>
            )}
          </AnimatePresence>
          {breakdown && legend && !phone && <div className="pointer-events-none absolute bottom-4 left-4 z-20">{legend}</div>}

          {/* BREAKDOWN and NEXT, bottom centre. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-start justify-center gap-[clamp(1.25rem,3.5vw,2.5rem)] px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] [&_button]:pointer-events-auto" style={{ height: "var(--end-bar)" }}>
            <div className="flex flex-col items-center gap-1.5 pt-[clamp(0.6rem,3vh,1.6rem)]">
              <button
                type="button"
                onClick={toggle}
                aria-label={t("end.breakdown")}
                aria-pressed={breakdown}
                aria-keyshortcuts="B"
                data-testid="geo-breakdown-toggle"
                className={cn(
                  "flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-full shadow-[0_4px_14px_rgb(0_0_0/0.45),inset_0_-3px_0_rgb(0_0_0/0.2)] ring-2 transition-[background-color,color,transform] duration-200 active:scale-95 md:h-[clamp(2.4rem,6.2vh,3.25rem)] md:w-[clamp(2.4rem,6.2vh,3.25rem)]",
                  breakdown ? "bg-white text-[#1e1a3f] ring-white/60" : "bg-[#4a3f9e] text-white ring-white/15 hover:bg-[#5a4fb8]"
                )}
              >
                <Menu className="h-[45%] w-[45%]" strokeWidth={2.75} aria-hidden />
              </button>
              <span className="font-display text-[11px] font-bold uppercase italic leading-none tracking-[0.08em] text-white/85 md:text-[clamp(0.68rem,1.75vh,0.85rem)]" aria-hidden>
                {t("end.breakdown")}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1.5 pt-[clamp(0.6rem,3vh,1.6rem)]">
              <button
                type="button"
                onClick={onNext}
                aria-keyshortcuts="Space"
                data-testid={nextTestId}
                className="flex h-[3.1rem] min-w-[10.5rem] items-center justify-center whitespace-nowrap rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] px-8 font-display text-xl font-bold uppercase italic tracking-wide text-white shadow-[0_4px_16px_rgb(76_187_23/0.45),inset_0_-4px_0_rgb(0_0_0/0.2),inset_0_2px_0_rgb(255_255_255/0.25)] ring-2 ring-[#1e1a3f]/40 transition-[filter,transform] hover:brightness-110 active:scale-[0.98] md:h-[clamp(2.5rem,6.4vh,3.5rem)] md:min-w-[clamp(9rem,25vh,15rem)] md:text-[clamp(1rem,2.9vh,1.5rem)]"
              >
                {t("end.next")}
              </button>
              <span className="hidden font-display text-[clamp(0.68rem,1.7vh,0.85rem)] font-semibold leading-none text-white/75 sm:inline [@media(pointer:coarse)]:!hidden" aria-hidden>
                {t.rich("end.hint", { kbd: (c) => <kbd className="mx-0.5 rounded border border-white/45 px-1.5 py-px font-display text-[0.85em] font-semibold uppercase">{c}</kbd> })}
              </span>
            </div>
          </div>
        </div>
      )}
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// The rows: what the game earned, sharing and the leaderboard
// ---------------------------------------------------------------------------

/** The gold line under the bar (GeoGuessr's "+ 162 XP"): what this game really did, a line each. */
export function EndLines({ lines }: { lines: { key: string; icon?: React.ReactNode; text: React.ReactNode; tone?: "gold" | "win" | "lose"; testId?: string }[] }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center" data-testid="geo-end-lines">
      {lines.map((l) => (
        <p
          key={l.key}
          className={cn(
            "flex items-center justify-center gap-2 font-display text-[clamp(1.05rem,3.2vh,1.6rem)] font-bold italic leading-tight [text-shadow:0_2px_0_#120f24]",
            l.tone === "win" ? "text-[#9be15d]" : l.tone === "lose" ? "text-[#ff8a8a]" : "text-[#ffd23c]"
          )}
          data-testid={l.testId}
        >
          {l.icon}
          <span>{l.text}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * GeoGuessr's medal row ("You earned your 1st Bronze medal"): each badge or achievement this game earned, its
 * medal beside it; two at most, then "+2 more".
 */
export function EndMedals({ items, more }: { items: { key: string; medal: React.ReactNode; text: React.ReactNode }[]; more?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2" data-testid="geo-end-medals">
      {items.map((m) => (
        <div key={m.key} className="flex min-w-0 items-center gap-3" data-testid="geo-end-medal">
          <span className="shrink-0 drop-shadow-[0_4px_8px_rgb(0_0_0/0.5)] [&>span]:!h-[clamp(2.25rem,7vh,3.4rem)] [&>span]:!w-[clamp(2.25rem,7vh,3.4rem)]">{m.medal}</span>
          <span className="min-w-0 font-display text-[clamp(0.95rem,2.7vh,1.3rem)] font-semibold italic leading-tight text-white [text-shadow:0_2px_0_#120f24]">{m.text}</span>
        </div>
      ))}
      {more && <span className="rounded-full bg-white/10 px-2.5 py-1 font-display text-xs font-bold uppercase italic text-[#c8bfff]">{more}</span>}
    </div>
  );
}

/** A medal's highlighted name inside its line. */
export const medalName = (chunks: React.ReactNode) => <span className="text-[#ffd23c]">{chunks}</span>;

/**
 * Progress made toward a badge not yet earned: its medal dimmed, its name, and how far along, with a little bar.
 */
export function EndProgress({ medal, text, have, need }: { medal: React.ReactNode; text: React.ReactNode; have: number; need: number }) {
  return (
    <div className="flex items-center gap-3" data-testid="geo-end-progress">
      <span className="shrink-0 opacity-80 [&>span]:!h-[clamp(2.25rem,7vh,3rem)] [&>span]:!w-[clamp(2.25rem,7vh,3rem)]">{medal}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-[clamp(0.9rem,2.5vh,1.15rem)] font-semibold italic leading-tight text-white [text-shadow:0_2px_0_#120f24]">{text}</span>
        <span className="h-1.5 w-40 overflow-hidden rounded-full bg-white/15" aria-hidden>
          <span className="block h-full rounded-full bg-[#ffd23c]" style={{ width: `${Math.round((have / Math.max(1, need)) * 100)}%` }} />
        </span>
      </span>
    </div>
  );
}

/** The result as coloured squares (the share text's), the share card's picture. */
export function ShareSquares({ rows, label }: { rows: string[][]; label: string }) {
  const tone: Record<string, string> = { "🟩": "bg-[#4cbb17]", "🟨": "bg-[#eab308]", "🟧": "bg-[#f97316]", "🟥": "bg-[#e5484d]", "✅": "bg-[#4cbb17]", "❌": "bg-[#e5484d]" };
  return (
    <span className="flex shrink-0 flex-col justify-center gap-[3px] rounded-lg bg-[#120f24]/70 p-1.5 ring-1 ring-white/10" role="img" aria-label={label} data-testid="geo-share-squares">
      {rows.map((row, i) => (
        <span key={i} className="flex gap-[3px]">
          {row.map((sq, k) => (
            <span key={k} className={cn("h-2 w-2 rounded-[2px] shadow-[inset_0_-1.5px_0_rgb(0_0_0/0.3)] md:h-2.5 md:w-2.5", tone[sq] ?? "bg-white/20")} />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * GeoGuessr's share card: the result's squares, "Share your result", the score, and a green SHARE (the phone's
 * share sheet, else the clipboard). It shares `text` with `url` under it; the whole text is the card's tooltip.
 */
export function EndShareCard({ title, sub, text, url, picture, kind, testId = "geo-share-card", buttonTestId = "geo-share" }: { title: string; sub: string; text: string; url?: string; picture: React.ReactNode; kind: string; testId?: string; buttonTestId?: string }) {
  const t = useT(geoNs);
  const st = useT(shareNs);
  const [state, setState] = useState<"idle" | "copied" | "shared" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const full = url ? `${text}\n${url}` : text;
  async function share() {
    const outcome = await shareOrCopy(text, url);
    if (outcome === "cancelled") return;
    setState(outcome);
    if (outcome === "failed") return;
    track("share", { kind, via: outcome });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  }
  const done = state === "copied" || state === "shared";
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        className="flex w-[min(100%,24rem)] items-center gap-3 rounded-xl bg-gradient-to-r from-[#2d2766] via-[#3b2f8f] to-[#4a3aa8] p-1.5 pr-2 text-left text-white shadow-[0_8px_24px_rgb(0_0_0/0.45)] ring-2 ring-[#8b7cff]/45"
        data-testid={testId}
        data-share={full}
        title={full}
      >
        {picture}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-display text-[0.95rem] font-bold italic leading-tight md:text-[clamp(0.95rem,2.6vh,1.15rem)]">{title}</span>
          <span className="block truncate text-xs text-white/75 md:text-[13px]">{sub}</span>
        </span>
        <button
          type="button"
          onClick={() => void share()}
          data-testid={buttonTestId}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] px-3 font-display text-sm font-bold uppercase italic tracking-wide md:px-4 text-white shadow-[0_3px_10px_rgb(76_187_23/0.4),inset_0_-3px_0_rgb(0_0_0/0.2)] transition-[filter,transform] hover:brightness-110 active:scale-95"
        >
          {done ? <Check className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {state === "copied" ? st("button.copied") : state === "shared" ? st("button.shared") : t("end.share")}
        </button>
      </div>
      {state === "failed" && (
        <div className="w-[min(100%,24rem)]">
          <CopyFallback text={full} />
        </div>
      )}
    </div>
  );
}

/**
 * The leaderboard, under sharing: a name and Save when the game can go on the board (the trainer's name filled
 * in), else why it can't; and the board itself, by the trophy.
 */
export function EndBoard({ href, boardLabel, save, note }: {
  href: string;
  boardLabel: string;
  /** A ranked result: its labels and how to save it. */
  save?: { label: string; placeholder: string; submit: string; saved: string; failed: string; onSave: (name: string) => Promise<void> };
  /** Why this game isn't on the board. */
  note?: string;
}) {
  const ct = useT(communityNs);
  const progress = useProgress();
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!save) return;
    if (!isCleanName(name)) {
      setError(ct("nameRejected"));
      setState("error");
      return;
    }
    setState("saving");
    setError(null);
    try {
      await save.onSave(name);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : save.failed);
      setState("error");
    }
  }

  const trophy = (
    <Link
      href={href}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ffd23c]/15 text-[#ffd23c] ring-1 ring-[#ffd23c]/40 transition-colors hover:bg-[#ffd23c]/25"
      aria-label={boardLabel}
      title={boardLabel}
      data-testid="geo-end-board-link"
    >
      <Trophy className="h-5 w-5" aria-hidden />
    </Link>
  );
  return (
    <div className="flex w-[min(100%,24rem)] flex-col gap-1.5" data-testid="geo-end-board">
      <div className="flex items-center gap-2.5 rounded-xl bg-[#1e1a3f]/85 p-1.5 text-white ring-1 ring-white/15 backdrop-blur">
        {trophy}
        {save ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={submit}>
            <label className="min-w-0 flex-1">
              <span className="block truncate font-display text-[10px] font-bold uppercase italic leading-none tracking-wide text-[#c8bfff]">{save.label}</span>
              <input
                id="geo-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                maxLength={24}
                required
                placeholder={save.placeholder}
                disabled={state === "saved"}
                autoComplete="nickname"
                className="mt-1 h-7 w-full min-w-0 rounded-md border border-white/20 bg-[#120f24]/80 px-2.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a99cff] disabled:opacity-60"
                data-testid="geo-end-name"
              />
            </label>
            <button
              type="submit"
              disabled={state === "saving" || state === "saved" || !name.trim()}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 font-display text-sm font-bold uppercase italic tracking-wide transition-colors disabled:cursor-not-allowed",
                state === "saved" ? "bg-[#4cbb17]/25 text-[#9be15d]" : "bg-[#6c5ce7] text-white hover:bg-[#7d6ff0] disabled:opacity-50"
              )}
              data-testid="geo-end-save"
            >
              {state === "saved" && <Check className="h-4 w-4" aria-hidden />}
              {state === "saved" ? save.saved : save.submit}
            </button>
          </form>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-xs leading-snug text-white/75" data-testid="geo-end-board-note">
              {note}
            </p>
            <Link href={href} className="shrink-0 rounded-lg bg-white/10 px-3 py-2 font-display text-xs font-bold uppercase italic tracking-wide text-white transition-colors hover:bg-white/20">
              {boardLabel}
            </Link>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-[#ff8a8a]">
          {error}
        </p>
      )}
    </div>
  );
}
