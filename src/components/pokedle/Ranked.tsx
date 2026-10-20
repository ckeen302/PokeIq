"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { animate, motion, useReducedMotion } from "framer-motion";
import { Flame, Loader2, Medal, Trophy, X } from "lucide-react";
import { RANKED_PROVISIONAL_GAMES, isProvisional, tierOf, type RankedStanding, type RankedTierId } from "@/lib/ranked";
import { rankedId, useRanked } from "@/lib/ranked-client";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { sfx } from "@/lib/duel-sfx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { clock } from "@/components/duel/DuelParts";
import { cn } from "@/lib/utils";

/** The ranked queue's matchmaking settings. */
export const RANKED_MATCH = { game: "pokedle", ranked: true };
/** What a ranked search sends with every poll: the browser's signed ranked id. */
export const rankedExtra = (): Record<string, unknown> => {
  const id = rankedId();
  return id ? { rankedId: id } : {};
};

const fmt = (n: number) => n.toLocaleString("en-US");

const BALL: Record<RankedTierId, { top: string; band?: string; text: string }> = {
  poke: { top: "#e3350d", text: "text-[#e3350d]" },
  great: { top: "#2a75bb", band: "#e3350d", text: "text-[#3b8fe0]" },
  ultra: { top: "#2b2b2b", band: "#f2c12e", text: "text-[#e0b021]" },
  master: { top: "#7a3fb8", band: "#e85aa8", text: "text-[#a368e0]" },
};

/** A ball in the tier's colours. */
export function BallIcon({ tier, className }: { tier: RankedTierId; className?: string }) {
  const b = BALL[tier];
  return (
    <svg viewBox="0 0 32 32" className={cn("h-6 w-6 shrink-0", className)} aria-hidden>
      <path d="M2 16a14 14 0 0 1 28 0Z" fill={b.top} />
      {b.band && tier === "great" && (
        <>
          <path d="M7 7.5 11 12" stroke={b.band} strokeWidth="3" strokeLinecap="round" />
          <path d="M25 7.5 21 12" stroke={b.band} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {b.band && tier === "ultra" && <path d="M9 4.5v8M23 4.5v8" stroke={b.band} strokeWidth="3.4" strokeLinecap="round" />}
      {b.band && tier === "master" && (
        <>
          <circle cx="9.5" cy="10" r="2.6" fill={b.band} />
          <circle cx="22.5" cy="10" r="2.6" fill={b.band} />
          <text x="16" y="12" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">M</text>
        </>
      )}
      <path d="M2 16a14 14 0 0 0 28 0Z" fill="#f4f4f4" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#1d1d1d" strokeWidth="2" />
      <path d="M2 16h28" stroke="#1d1d1d" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.4" fill="#f4f4f4" stroke="#1d1d1d" strokeWidth="2" />
    </svg>
  );
}

/** "Great Ball II · 1,312": the tier badge, with the rating. */
export function TierBadge({ rating, games, className, size = "md" }: { rating: number; games?: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const t = tierOf(rating);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={`${t.label} · ${fmt(rating)} rating`}>
      <BallIcon tier={t.tier} className={size === "lg" ? "h-10 w-10" : size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
      <span className={cn("truncate font-display font-bold uppercase", BALL[t.tier].text, size === "lg" ? "text-2xl" : size === "sm" ? "text-[11px]" : "text-sm")}>{t.label}</span>
      <span className={cn("font-pixel tabular-nums text-muted-foreground", size === "sm" ? "text-[9px]" : "text-xs")}>{fmt(rating)}</span>
      {games !== undefined && isProvisional(games) && (
        <span className="rounded-sm border border-foreground/15 px-1 font-pixel text-[8px] uppercase text-muted-foreground" title={`Provisional: ratings move faster for the first ${RANKED_PROVISIONAL_GAMES} games`}>
          Prov.
        </span>
      )}
    </span>
  );
}

/** How far through the division, and what's next. */
export function TierProgress({ rating, from }: { rating: number; from?: number }) {
  const t = tierOf(rating);
  const reduced = useReducedMotion();
  const start = from !== undefined && tierOf(from).step === t.step ? tierOf(from).progress : t.progress;
  return (
    <div className="space-y-1">
      <span className="block h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.progress * 100)} aria-label={`Progress to ${t.next?.label ?? "the top"}`}>
        <motion.span
          className={cn("block h-full rounded-full", t.tier === "master" ? "bg-[#a368e0]" : "bg-screen")}
          initial={{ width: `${Math.max(2, start * 100)}%` }}
          animate={{ width: `${Math.max(2, t.progress * 100)}%` }}
          transition={{ duration: reduced ? 0 : 1.1, delay: reduced ? 0 : 0.5, ease: "easeOut" }}
        />
      </span>
      <p className="flex justify-between text-[11px] text-muted-foreground">
        <span>{t.label}</span>
        <span>{t.next ? `${fmt(Math.max(0, t.next.at - rating))} to ${t.next.label}` : "The top tier"}</span>
      </p>
    </div>
  );
}

function Record({ you }: { you: RankedStanding }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {you.position !== null && (
        <span className="flex items-center gap-1">
          <Medal className="h-3.5 w-3.5 text-warning" aria-hidden /> <b className="text-foreground">#{fmt(you.position)}</b> of {fmt(you.players)}
        </span>
      )}
      <span>
        {you.wins}W · {you.losses}L{you.draws ? ` · ${you.draws}D` : ""}
      </span>
      {you.streak > 0 && (
        <span className="flex items-center gap-1 font-semibold text-warning">
          <Flame className="h-3.5 w-3.5" aria-hidden /> {you.streak} win streak
        </span>
      )}
      {you.bestStreak > 1 && <span>Best streak {you.bestStreak}</span>}
    </div>
  );
}

/** Device time, ticking while `on`. */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** "Searching…" with the time so far, and a cancel button. */
export function Searching({ since, onCancel, ranked }: { since: number | null; onCancel: () => void; ranked?: boolean }) {
  const now = useTicker(true);
  const waited = now - (since ?? now);
  return (
    <div className="space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status">
      <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {ranked ? "Searching for a ranked rival…" : "Searching for an opponent…"}
      </p>
      <p className="font-pixel text-xs tabular-nums text-muted-foreground">
        {clock(waited)}
        {ranked && waited > 10_000 ? " · widening the search" : ""}
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        <X className="h-3.5 w-3.5" aria-hidden /> Cancel
      </Button>
    </div>
  );
}

/**
 * Ranked on /pokedle: your tier, rating, streak and place on the ladder,
 * and the button that queues you against someone near your rating.
 */
export function RankedCard() {
  const { state } = useRanked();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finder = useMatchmaking(RANKED_MATCH);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const you = state.status === "ready" ? state.you : null;
  return (
    <Card className="overflow-hidden border-warning/40">
      <CardContent className={cn("grid gap-5 p-6", state.status !== "off" && "md:grid-cols-[1fr_18rem]")}>
        <div className="min-w-0 space-y-3">
          <p className="hud-label flex items-center gap-1.5 text-warning">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Ranked
          </p>
          {state.status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading your rank…</p>
          ) : state.status === "off" ? (
            <p className="text-sm text-muted-foreground">Ranked play opens soon. Casual duels are on: find an opponent or duel a friend below.</p>
          ) : you ? (
            <>
              <TierBadge rating={you.rating} games={you.games} size="lg" />
              <TierProgress rating={you.rating} />
              <Record you={you} />
            </>
          ) : (
            <>
              <TierBadge rating={1000} games={0} size="lg" />
              <p className="text-sm text-muted-foreground">
                Everyone starts at 1,000. Win to climb from Poké Ball to Master Ball; your first {RANKED_PROVISIONAL_GAMES} games move your rating faster.
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Matched with trainers near your rating, every generation, always with the Notebook Pokédex (the same assist for everyone on the ladder). Leaving
            counts as a loss.{" "}
            <Link href="/leaderboard?board=pokedle" className="underline underline-offset-2 hover:text-foreground">
              Ranked ladder
            </Link>
          </p>
          {(error ?? finder.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? finder.error}
            </p>
          )}
        </div>
        {state.status !== "off" && (
          <div className="flex flex-col justify-center gap-2">
            <label htmlFor={id} className="hud-label">
              Ranked trainer name
            </label>
            <input
              id={id}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={24}
              disabled={finder.searching}
              placeholder="Trainer name"
              className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {finder.searching ? (
              <Searching since={finder.since} onCancel={finder.cancel} ranked />
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={state.status !== "ready" || !name.trim()}
                onClick={() => (isCleanName(name) ? void finder.search(name.trim(), rankedExtra()) : setError(NAME_REJECTED))}
              >
                <Trophy className="h-4 w-4" aria-hidden /> Queue ranked
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Counts up (or down) to `to`. */
function useCount(to: number, reduced: boolean | null): number {
  const [shown, setShown] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) {
      setShown(to);
      return;
    }
    const controls = animate(0, to, { duration: 1.1, delay: 0.4, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [to, reduced]);
  return shown;
}

/**
 * After a ranked duel: "+18" counting up, the new rating and tier, the bar
 * filling, and a promotion moment when the trainer moved up a division.
 */
export function RatingChange({ before, after, provisional }: { before: number; after: number; provisional?: boolean }) {
  const reduced = useReducedMotion();
  const delta = after - before;
  const shown = useCount(delta, reduced);
  const promoted = tierOf(after).step > tierOf(before).step;
  const demoted = tierOf(after).step < tierOf(before).step;
  useEffect(() => {
    if (promoted) sfx("fanfare");
  }, [promoted]);
  return (
    <div className="space-y-3 rounded-md border border-warning/40 bg-warning/[0.05] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TierBadge rating={after} />
        <motion.span
          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.2 }}
          className={cn("font-display text-4xl font-bold tabular-nums", delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")}
          aria-label={`Rating ${delta >= 0 ? "+" : ""}${delta}, now ${after}`}
        >
          {shown > 0 ? "+" : ""}
          {shown}
        </motion.span>
      </div>
      <TierProgress rating={after} from={before} />
      {provisional && <p className="text-[11px] text-muted-foreground">Provisional: your first {RANKED_PROVISIONAL_GAMES} ranked games move your rating faster.</p>}
      {promoted && (
        <motion.div
          initial={reduced ? false : { scale: 0.7, opacity: 0, rotate: -4 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 10, delay: 1.4 }}
          className="flex items-center justify-center gap-3 rounded-md border border-success/50 bg-success/10 p-3 text-center"
          role="status"
        >
          <BallIcon tier={tierOf(after).tier} className="h-9 w-9" />
          <span className="font-display text-xl font-bold uppercase text-success">Promoted to {tierOf(after).label}!</span>
        </motion.div>
      )}
      {demoted && <p className="text-center text-xs text-muted-foreground">Down to {tierOf(after).label}. Win the next one to climb back.</p>}
    </div>
  );
}

/** On the ranked ladder: where you stand, even outside the top 100. */
export function YourLadderSpot() {
  const { state } = useRanked();
  if (state.status !== "ready") return null;
  const you = state.you;
  return (
    <Card className="border-warning/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        {you && you.games > 0 ? (
          <>
            <span className="flex items-center gap-3">
              <span className="font-pixel text-sm text-muted-foreground">#{fmt(you.position ?? 0)}</span>
              <TierBadge rating={you.rating} games={you.games} />
            </span>
            <Record you={you} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You&apos;re not on the ladder yet.{" "}
            <Link href="/pokedle#ranked" className="text-primary underline-offset-2 hover:underline">
              Play a ranked duel
            </Link>{" "}
            to get your rank.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
