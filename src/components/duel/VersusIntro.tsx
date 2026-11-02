"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type MotionProps } from "framer-motion";
import { Check, FastForward, Minus, X } from "lucide-react";
import type { PublicAvatar } from "@/lib/avatar";
import type { VersusResult, VersusStats, VersusStatsResponse } from "@/lib/duel-stats";
import { cn } from "@/lib/utils";
import { VersusCharacter } from "./VersusCharacter";
import type { TrainerConfig } from "@/lib/trainer/config";

/**
 * The versus screen before a duel's first round, GeoGuessr's: the two
 * trainers' characters squaring up across a diagonal split, "Round 1" over
 * the top, and a card per trainer with their public duel record (duels
 * played, how often they lock in first, strongest and toughest regions,
 * the last five results; ranked adds the division badge). Any game's duel
 * can use it: the caller passes each side and the countdown.
 *
 * It lasts as long as the round's lead-in. Skipping (the button, Space or
 * Enter) folds it down to the title and the countdown.
 */

export interface VersusSide {
  name: string;
  /** This is the trainer looking at the screen. */
  you?: boolean;
  avatar?: PublicAvatar | null;
  /** A computer opponent's figure, drawn instead of an avatar. */
  figure?: React.ReactNode;
  /** Shown by the name (e.g. the Gym Leader tag). */
  tag?: React.ReactNode;
  /** Under the name (e.g. the ranked division badge). */
  badge?: React.ReactNode;
  /** undefined while loading; null when there's no record to show (a guest). */
  stats: VersusStats | null | undefined;
  /** A game's own record, in place of the PokéGuessr duel stats (the card's body). */
  record?: React.ReactNode;
  /** A 3D trainer for a trainer who hasn't made one (instead of their art or a silhouette). */
  fallback?: TrainerConfig;
  /** The side's colour (its glow and the card's edge). */
  accent: string;
}

export interface VersusIntroProps {
  left: VersusSide;
  right: VersusSide;
  title: string;
  /** Under the title: the mode, the map. */
  subtitle?: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  /** The countdown to the round (a big digit). */
  countdown?: React.ReactNode;
  testId?: string;
  /** Skipping ends the intro (the caller closes it) instead of folding it down to the countdown. */
  onSkip?: () => void;
}

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function VersusIntro({ left, right, title, subtitle, detail, icon, countdown, testId = "versus-intro", onSkip }: VersusIntroProps) {
  const reduced = useReducedMotion();
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (skipped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, button, a")) return;
      e.preventDefault();
      setSkipped(true);
      onSkip?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skipped, onSkip]);

  const from = (x: number, delay = 0): MotionProps => (reduced ? { initial: false as const } : { initial: { opacity: 0, x }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.45, ease: EASE, delay } });

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#14112b] text-white" data-testid={testId} data-skipped={skipped ? "true" : undefined}>
      <SplitBackdrop left={left.accent} right={right.accent} reduced={!!reduced} />

      <motion.header
        initial={reduced ? false : { opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="relative z-10 flex flex-col items-center gap-0.5 px-4 pt-14 text-center sm:pt-10"
      >
        {icon}
        <h2 className="font-display text-4xl font-extrabold uppercase italic leading-none drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-6xl">{title}</h2>
        {subtitle && <p className="mt-1 font-display text-sm font-bold uppercase text-[#ffd23c] sm:text-lg">{subtitle}</p>}
        {detail && <p className="font-display text-xs uppercase tracking-wider text-white/70 sm:text-sm">{detail}</p>}
      </motion.header>

      <AnimatePresence initial={false}>
        {!skipped && (
          <motion.div
            key="stage"
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] content-center items-start gap-1 px-3 sm:gap-4 sm:px-8 lg:items-center lg:px-16"
          >
            <Side side={left} align="left" motionProps={from(-80)} cardMotion={from(-40, 0.15)} />
            <motion.span
              initial={reduced ? false : { scale: 0.3, opacity: 0, rotate: -14 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.3 }}
              className="geo-glow mt-[calc(min(18vw,4.75rem)-1.5rem)] font-display text-4xl font-extrabold italic sm:mt-[calc(min(15vw,7.5rem)-2.5rem)] sm:text-6xl lg:mt-0 lg:text-8xl"
              aria-label="versus"
            >
              VS
            </motion.span>
            <Side side={right} align="right" motionProps={from(80)} cardMotion={from(40, 0.15)} />
          </motion.div>
        )}
      </AnimatePresence>
      {skipped && <div className="flex-1" />}

      <footer className="relative z-10 flex h-24 shrink-0 items-center justify-center sm:h-32">
        {countdown}
        {!skipped && (
          <button
            type="button"
            onClick={() => {
              setSkipped(true);
              onSkip?.();
            }}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-white/85 ring-1 ring-white/20 backdrop-blur transition hover:bg-black/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd23c] sm:bottom-6 sm:right-6"
            data-testid="versus-skip"
          >
            Skip <FastForward className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </footer>
    </div>
  );
}

function Side({ side, align, motionProps, cardMotion }: { side: VersusSide; align: "left" | "right"; motionProps: MotionProps; cardMotion: MotionProps }) {
  const isLeft = align === "left";
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-2 sm:gap-4 lg:flex-row", isLeft ? "lg:justify-end" : "lg:flex-row-reverse lg:justify-end")} data-testid={`versus-side-${align}`}>
      <motion.div {...cardMotion} className="order-2 w-full max-w-[17.5rem] lg:order-1">
        <StatCard side={side} />
      </motion.div>
      <motion.div {...motionProps} className="order-1 w-[min(36vw,9.5rem)] shrink-0 sm:w-[min(30vw,15rem)] lg:order-2 lg:w-[min(23vw,21rem)]">
        <div className="relative">
          <div aria-hidden className="absolute inset-x-[12%] bottom-[2%] h-[12%] rounded-[50%] bg-black/45 blur-md" />
          <div aria-hidden className="absolute inset-[14%] rounded-full opacity-60 blur-3xl" style={{ background: side.accent }} />
          <VersusCharacter avatar={side.avatar} figure={side.figure} fallback={side.fallback} facing={isLeft ? "right" : "left"} className="relative w-full" />
        </div>
      </motion.div>
    </div>
  );
}

function StatCard({ side }: { side: VersusSide }) {
  const { stats } = side;
  const loading = stats === undefined;
  const dash = loading ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-white/15 align-middle" aria-label="Loading" /> : "—";
  return (
    <div className="overflow-hidden rounded-xl border border-white/15 bg-[#1e1a3f]/90 shadow-2xl backdrop-blur-sm" style={{ borderTopColor: side.accent, borderTopWidth: 4 }} data-testid="versus-card">
      <div className="space-y-1 px-3 pb-2 pt-2.5 sm:px-4 sm:pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate font-display text-sm font-extrabold uppercase italic sm:text-xl" title={side.name}>
            {side.name}
          </p>
          {side.you && <span className="shrink-0 rounded-sm bg-white/15 px-1.5 font-pixel text-[9px] uppercase">You</span>}
        </div>
        {(side.tag || side.badge) && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{side.tag}{side.badge}</div>}
      </div>
      {side.record ?? (
        <>
          <dl className="grid grid-cols-2 border-y border-white/10 text-center">
            <Figure label="Duels" value={stats ? stats.duels.toLocaleString("en-US") : dash} />
            <Figure label="Guessed first" value={stats && stats.guessedFirst !== null ? `${stats.guessedFirst}%` : dash} className="border-l border-white/10" />
          </dl>
          <div className="space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <Regions label="Strongest" regions={stats?.strongest} dash={dash} tone="text-[#8ee26b]" />
            <Regions label="Toughest" regions={stats?.toughest} dash={dash} tone="text-[#ff8a8a]" />
            <History recent={stats?.recent} loading={loading} />
          </div>
        </>
      )}
    </div>
  );
}

export function Figure({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-2 py-1.5 sm:py-2", className)}>
      <dt className="font-pixel text-[8px] uppercase text-white/55 sm:text-[9px]">{label}</dt>
      <dd className="font-display text-lg font-extrabold tabular-nums leading-tight sm:text-2xl">{value}</dd>
    </div>
  );
}

function Regions({ label, regions, dash, tone }: { label: string; regions: string[] | undefined; dash: React.ReactNode; tone: string }) {
  return (
    <div className="min-w-0">
      <p className="font-pixel text-[8px] uppercase text-white/55 sm:text-[9px]">{label} regions</p>
      <p className={cn("font-display text-xs font-bold leading-snug sm:text-sm", regions?.length ? tone : "text-white/60")}>
        {regions?.length ? regions.join(" · ") : dash}
      </p>
    </div>
  );
}

const RESULT_STYLE: Record<VersusResult, { cls: string; label: string; Icon: typeof Check }> = {
  win: { cls: "bg-[#4cbb17] text-white", label: "Won", Icon: Check },
  loss: { cls: "bg-[#e5484d] text-white", label: "Lost", Icon: X },
  draw: { cls: "bg-white/30 text-white", label: "Draw", Icon: Minus },
};

export function History({ recent, loading, label = "Last 5 duels", none = "No duels yet" }: { recent: VersusResult[] | undefined; loading: boolean; label?: string; none?: string }) {
  const slots = Array.from({ length: 5 }, (_, i) => recent?.[i] ?? null);
  return (
    <div>
      <p className="font-pixel text-[8px] uppercase text-white/55 sm:text-[9px]">{label}</p>
      <ol className="mt-1 flex gap-1" aria-label={recent?.length ? `Latest first: ${recent.map((r) => RESULT_STYLE[r].label).join(", ")}` : none} data-testid="versus-history">
        {slots.map((r, i) => {
          if (!r) return <li key={i} className={cn("h-5 w-5 rounded-full border border-dashed border-white/25 sm:h-6 sm:w-6", loading && "animate-pulse")} aria-hidden />;
          const { cls, Icon } = RESULT_STYLE[r];
          return (
            <li key={i} className={cn("flex h-5 w-5 items-center justify-center rounded-full sm:h-6 sm:w-6", cls)} aria-hidden data-result={r}>
              <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" strokeWidth={3.5} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The two sides' panels split on a diagonal, with a bright seam and faint speed lines. */
function SplitBackdrop({ left, right, reduced }: { left: string; right: string; reduced: boolean }) {
  const panel = (x: number): MotionProps => (reduced ? { initial: false as const } : { initial: { x: `${x}%` }, animate: { x: "0%" }, transition: { duration: 0.5, ease: EASE } });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <motion.div
        {...panel(-60)}
        className="absolute inset-0"
        style={{ clipPath: "polygon(0 0, 57% 0, 43% 100%, 0 100%)", background: `radial-gradient(ellipse at 25% 60%, color-mix(in srgb, ${left} 45%, transparent), transparent 65%), linear-gradient(160deg, #2a2560, #16132f 70%)` }}
      />
      <motion.div
        {...panel(60)}
        className="absolute inset-0"
        style={{ clipPath: "polygon(57% 0, 100% 0, 100% 100%, 43% 100%)", background: `radial-gradient(ellipse at 75% 60%, color-mix(in srgb, ${right} 45%, transparent), transparent 65%), linear-gradient(200deg, #2f1f5c, #16132f 70%)` }}
      />
      <div className="absolute inset-0 opacity-[0.07]" style={{ background: "repeating-linear-gradient(115deg, #fff 0 2px, transparent 2px 46px)" }} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="57" y1="0" x2="43" y2="100" stroke="#ffd23c" strokeWidth="5" vectorEffect="non-scaling-stroke" opacity="0.25" />
        <line x1="57" y1="0" x2="43" y2="100" stroke="#ffd23c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading the record
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<VersusStatsResponse["stats"]>>();

/** Both trainers' duel stats by name (undefined while loading, null for a name with no record). Cached for the page's life. */
export function useVersusStats(endpoint: string, names: (string | null | undefined)[]): (VersusStats | null | undefined)[] {
  const wanted = names.map((n) => n?.trim().toLowerCase() || null);
  const key = wanted.filter(Boolean).sort().join(",");
  const [stats, setStats] = useState<VersusStatsResponse["stats"] | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const url = `${endpoint}?names=${encodeURIComponent(key)}`;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<VersusStatsResponse>) : { stats: {} }))
        .then((r) => r.stats ?? {})
        .catch(() => ({}));
      cache.set(url, p);
    }
    void p.then((s) => live && setStats(s));
    return () => {
      live = false;
    };
  }, [endpoint, key]);
  return wanted.map((n) => (!n ? null : stats ? (stats[n] ?? null) : undefined));
}
