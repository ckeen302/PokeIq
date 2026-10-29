"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { animate, motion, useReducedMotion } from "framer-motion";
import { Bot, Loader2, Medal, ShieldCheck, Trophy, X } from "lucide-react";
import {
  GEO_DIVISIONS,
  GEO_ELO_START,
  GEO_RANKED_MATCH,
  geoDivisionOf,
  gymLeaderOf,
  type GeoDivisionId,
  type GeoRankedStanding,
} from "@/lib/geo-ranked";
import { useGeoRanked } from "@/lib/geo-ranked-client";
import { DUEL_HP, type DuelView } from "@/lib/duel-types";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { sfx } from "@/lib/duel-sfx";
import { typeColor } from "@/lib/pokemon/type-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { clock } from "@/components/duel/DuelParts";
import { HowItWorks } from "@/components/duel/HowItWorks";
import { BallIcon, rankedExtra } from "@/components/pokedle/Ranked";
import { cn } from "@/lib/utils";
import { DuelHistoryLink, GeoSeasonStrip } from "./GeoSeason";

/**
 * Ranked PokéGuessr in the browser: the division badge (Poké Ball to Beast
 * Ball, the Elo shown from Ultra Ball up), the ranked panel on /guessr with
 * the queue and the Gym Leader offer, the honest bot's tag and avatar, and
 * the outcome after a ranked duel. Mirrors Pokédle's ranked UI (Ranked.tsx).
 */

const fmt = (n: number) => n.toLocaleString("en-US");

const TEXT: Record<GeoDivisionId, string> = {
  poke: "text-[#e3350d]",
  great: "text-[#3b8fe0]",
  ultra: "text-[#e0b021]",
  master: "text-[#a368e0]",
  beast: "text-[#2fb8d8]",
};
const BAR: Record<GeoDivisionId, string> = {
  poke: "bg-[#e3350d]",
  great: "bg-[#3b8fe0]",
  ultra: "bg-[#e0b021]",
  master: "bg-[#a368e0]",
  beast: "bg-[#2fb8d8]",
};

/** A ball in the division's colours: Pokédle's four, and the Beast Ball for the top. */
export function GeoBallIcon({ division, className }: { division: GeoDivisionId; className?: string }) {
  if (division !== "beast") return <BallIcon tier={division} className={className} />;
  return (
    <svg viewBox="0 0 32 32" className={cn("h-6 w-6 shrink-0", className)} aria-hidden>
      <path d="M2 16a14 14 0 0 1 28 0Z" fill="#2457c5" />
      <path d="M16 3v9M6.5 7.5 11 12.5M25.5 7.5 21 12.5" stroke="#f2c12e" strokeWidth="3" strokeLinecap="round" />
      <path d="M2 16a14 14 0 0 0 28 0Z" fill="#f4f4f4" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#1d1d1d" strokeWidth="2" />
      <path d="M2 16h28" stroke="#1d1d1d" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.4" fill="#f4f4f4" stroke="#1d1d1d" strokeWidth="2" />
      <circle cx="16" cy="16" r="2" fill="#f2c12e" />
    </svg>
  );
}

/**
 * "Ultra Ball · 1,262": the division badge. The number is shown only where
 * the division shows it (Ultra Ball up); `elo` null (a ladder row whose
 * number is hidden) shows the division alone.
 */
export function GeoDivisionBadge({ elo, division, className, size = "md" }: { elo: number | null; division?: GeoDivisionId; className?: string; size?: "sm" | "md" | "lg" }) {
  const d = geoDivisionOf(elo ?? (division ? GEO_DIVISIONS.find((x) => x.id === division)!.from : GEO_ELO_START));
  const id = division ?? d.id;
  const name = GEO_DIVISIONS.find((x) => x.id === id)!.name;
  const shown = elo !== null && d.showElo;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={shown ? `${name} · ${fmt(elo)} Elo` : name} data-testid="geo-division-badge" data-division={id}>
      <GeoBallIcon division={id} className={size === "lg" ? "h-10 w-10" : size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
      <span className={cn("truncate font-display font-bold uppercase", TEXT[id], size === "lg" ? "text-2xl" : size === "sm" ? "text-[11px]" : "text-sm")}>{name}</span>
      {shown && <span className={cn("font-pixel tabular-nums text-muted-foreground", size === "sm" ? "text-[9px]" : "text-xs")}>{fmt(elo)}</span>}
    </span>
  );
}

/** How far through the division, and what's next. */
export function GeoDivisionProgress({ elo, from }: { elo: number; from?: number }) {
  const d = geoDivisionOf(elo);
  const reduced = useReducedMotion();
  const start = from !== undefined && geoDivisionOf(from).index === d.index ? geoDivisionOf(from).progress : d.progress;
  return (
    <div className="space-y-1">
      <span className="block h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.progress * 100)} aria-label={`Progress to ${d.next ?? "the top"}`}>
        <motion.span
          className={cn("block h-full rounded-full", BAR[d.id])}
          initial={{ width: `${Math.max(2, start * 100)}%` }}
          animate={{ width: `${Math.max(2, d.progress * 100)}%` }}
          transition={{ duration: reduced ? 0 : 1.1, delay: reduced ? 0 : 0.5, ease: "easeOut" }}
        />
      </span>
      <p className="flex justify-between text-[11px] text-muted-foreground">
        <span>{d.name}</span>
        <span>{d.next ? (d.showElo ? `${fmt(Math.max(0, d.to! - elo))} to ${d.next}` : `Next: ${d.next}`) : "The top division"}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Gym Leader bot, labelled as such everywhere it appears
// ---------------------------------------------------------------------------

/** The "Gym Leader" tag next to the bot's name: it is a computer opponent, never a trainer. */
export function GymLeaderTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-sm border border-warning/60 bg-warning/10 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-warning", className)} title="A computer opponent: the Gym Leader plays for the ladder when no trainer is around" data-testid="geo-gym-leader-badge">
      <Bot className="h-3 w-3" aria-hidden /> Gym Leader
    </span>
  );
}

/** A trainer-class avatar for the bot: the Gym Leader's initial on a plate in their specialty type's colour. */
export function GymLeaderAvatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const leader = gymLeaderOf(name);
  const c = typeColor((leader?.type ?? "normal").toLowerCase());
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border-2 font-display font-bold uppercase text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.5, borderColor: c, background: `radial-gradient(circle at 30% 25%, rgb(255 255 255 / 0.28), transparent 55%), linear-gradient(145deg, ${c}, color-mix(in srgb, ${c} 45%, #0b0f14))`, textShadow: "0 2px 0 rgb(0 0 0 / 0.35)" }}
      data-testid="geo-gym-leader-avatar"
    >
      {(leader?.name ?? "?").slice(0, 1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The ranked panel
// ---------------------------------------------------------------------------

function Record({ you }: { you: GeoRankedStanding }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="geo-ranked-record">
      {you.position !== null && (
        <span className="flex items-center gap-1">
          <Medal className="h-3.5 w-3.5 text-warning" aria-hidden /> <b className="text-foreground">#{fmt(you.position)}</b> of {fmt(you.players)}
        </span>
      )}
      <span>
        {you.wins}W · {you.losses}L{you.draws ? ` · ${you.draws}D` : ""}
      </span>
      {you.bestScore > 0 && <span>Best {fmt(you.bestScore)} pts</span>}
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

/**
 * "Searching for a ranked rival…" with the time so far, how the bracket is
 * widening, a cancel button, and once the wait is long enough, the honest
 * offer of a Gym Leader.
 */
function Searching({ since, onCancel, botAfterMs, onBot, takingBot }: { since: number | null; onCancel: () => void; botAfterMs: number | null; onBot: () => void; takingBot: boolean }) {
  const now = useTicker(true);
  const waited = now - (since ?? now);
  const offer = botAfterMs !== null && waited >= botAfterMs;
  return (
    <div className="space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status" data-testid="geo-ranked-searching">
      <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching for a ranked rival…
      </p>
      <p className="font-pixel text-xs tabular-nums text-muted-foreground">
        {clock(waited)}
        {waited >= 45_000 ? " · any trainer" : waited >= 15_000 ? " · widening the search" : " · trainers near your Elo"}
      </p>
      {offer && (
        <div className="space-y-2 rounded-md border border-warning/50 bg-warning/[0.08] p-2" data-testid="geo-ranked-bot-offer">
          <p className="text-xs text-foreground">No trainer found yet. Battle a Gym Leader?</p>
          <p className="text-[11px] text-muted-foreground">A computer opponent that plays at your division. Rated, at half the usual swing.</p>
          <Button type="button" size="sm" variant="secondary" disabled={takingBot} onClick={onBot} data-testid="geo-ranked-bot">
            {takingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />} Battle a Gym Leader
          </Button>
        </div>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        <X className="h-3.5 w-3.5" aria-hidden /> Cancel
      </Button>
    </div>
  );
}

/**
 * Ranked on /guessr: your division, Elo (from Ultra Ball up), record and
 * place on the ladder, and the button that queues you for a head-to-head
 * HP duel on the world map against someone near your Elo.
 */
export function GeoRankedCard() {
  const { state } = useGeoRanked();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finder = useMatchmaking(GEO_RANKED_MATCH);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const you = state.status === "ready" ? state.you : null;
  return (
    <Card className="overflow-hidden border-warning/40" data-testid="geo-ranked-card">
      <CardContent className={cn("grid gap-5 p-6", state.status !== "off" && "md:grid-cols-[1fr_15rem]")}>
        <div className="min-w-0 space-y-3">
          <p className="hud-label flex items-center gap-1.5 text-warning">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Ranked · World map
          </p>
          {state.status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading your rank…</p>
          ) : state.status === "off" ? (
            <p className="text-sm text-muted-foreground">Ranked PokéGuessr opens soon. Casual duels are on: switch to Casual to find an opponent or duel a friend.</p>
          ) : you && you.games > 0 ? (
            <>
              <GeoDivisionBadge elo={you.elo} size="lg" />
              <GeoDivisionProgress elo={you.elo} />
              <Record you={you} />
            </>
          ) : (
            <>
              <GeoDivisionBadge elo={GEO_ELO_START} size="lg" />
              <p className="text-sm text-muted-foreground">Head to head on the world map. Climb from Poké Ball to Beast Ball against trainers near your Elo.</p>
            </>
          )}
          {state.status === "ready" && state.season && <GeoSeasonStrip season={state.season} elo={you && you.games > 0 ? you.elo : null} />}
          {state.status !== "off" && (
            <HowItWorks
              extra={
                <>
                  <Link href="/leaderboard?board=geo-ranked" className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    Ranked ladder
                  </Link>
                  <DuelHistoryLink />
                </>
              }
            >
              <p>
                The same places for you both, {fmt(DUEL_HP)} HP each: every round, the lower score loses the difference. Always the world map, every game. Leaving counts as a loss.
              </p>
              <p>
                Everyone starts at 1,000 Elo, rated as Pokémon Showdown rates battles: Poké Ball and Great Ball show your division only; from Ultra Ball up the number shows too. Ratings above 1,400
                drift down a little on days you don&apos;t play.
              </p>
              <p>
                You&apos;re matched with trainers near your Elo, further apart the longer you wait. If nobody turns up in {state.status === "ready" && state.botAfterS > 0 ? `${state.botAfterS} seconds` : "a while"}, you can battle a Gym Leader
                instead: a clearly labelled computer opponent that plays at your division, rated at half the usual swing.
              </p>
              <p>
                Ranked runs in eight-week seasons. Your highest division in a season earns its rewards (a season badge, and cosmetics for every division up to it) when the season ends. Then
                every rating resets halfway toward 1,000, down one division at most, so the climb starts again close to where you finished.
              </p>
            </HowItWorks>
          )}
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
              data-testid="geo-ranked-name"
              className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {finder.searching ? (
              <Searching since={finder.since} onCancel={finder.cancel} botAfterMs={finder.botAfterMs} onBot={() => void finder.takeBot()} takingBot={finder.takingBot} />
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={state.status !== "ready" || !name.trim()}
                onClick={() => (isCleanName(name) ? void finder.search(name.trim(), rankedExtra()) : setError(NAME_REJECTED))}
                data-testid="geo-ranked-queue"
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

// ---------------------------------------------------------------------------
// After a ranked duel
// ---------------------------------------------------------------------------

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
 * The rating change: old → new division, the Elo change (from Ultra Ball
 * up) counting up, the bar filling, and a promotion moment when the trainer
 * moved up a division.
 */
export function GeoRatingChange({ before, after, bot }: { before: number; after: number; bot?: boolean }) {
  const reduced = useReducedMotion();
  const delta = after - before;
  const shown = useCount(delta, reduced);
  const from = geoDivisionOf(before);
  const to = geoDivisionOf(after);
  const promoted = to.index > from.index;
  const demoted = to.index < from.index;
  useEffect(() => {
    if (promoted) sfx("fanfare");
  }, [promoted]);
  return (
    <div className="space-y-3 rounded-md border border-warning/40 bg-warning/[0.05] p-4" data-testid="geo-ranked-outcome">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          {from.index !== to.index && (
            <>
              <GeoDivisionBadge elo={null} division={from.id} size="sm" />
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
            </>
          )}
          <GeoDivisionBadge elo={after} />
        </span>
        {to.showElo ? (
          <motion.span
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.2 }}
            className={cn("font-display text-4xl font-bold tabular-nums", delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")}
            aria-label={`Elo ${delta >= 0 ? "+" : ""}${delta}, now ${after}`}
            data-testid="geo-ranked-delta"
          >
            {shown > 0 ? "+" : ""}
            {shown}
          </motion.span>
        ) : (
          <span className={cn("font-display text-sm font-bold uppercase", delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")} data-testid="geo-ranked-trend">
            {delta > 0 ? "Climbing" : delta < 0 ? "Slipping" : "Holding"}
          </span>
        )}
      </div>
      <GeoDivisionProgress elo={after} from={before} />
      {bot && <p className="text-[11px] text-muted-foreground">A Gym Leader duel: rated at half the usual swing.</p>}
      {promoted && (
        <motion.div
          initial={reduced ? false : { scale: 0.7, opacity: 0, rotate: -4 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 10, delay: 1.4 }}
          className="flex items-center justify-center gap-3 rounded-md border border-success/50 bg-success/10 p-3 text-center"
          role="status"
        >
          <GeoBallIcon division={to.id} className="h-9 w-9" />
          <span className="font-display text-xl font-bold uppercase text-success">Promoted to {to.name}!</span>
        </motion.div>
      )}
      {demoted && <p className="text-center text-xs text-muted-foreground">Down to {to.name}. Win the next one to climb back.</p>}
    </div>
  );
}

/** After a ranked PokéGuessr duel: the rating change once it has been counted, and your place on the ladder. */
export function GeoRankedOutcome({ view }: { view: DuelView }) {
  const me = view.you!;
  const result = view.ranked?.result;
  const { state, reload } = useGeoRanked({ enabled: !!result });
  useEffect(() => {
    if (result) reload();
  }, [result, reload]);
  if (!view.ranked) return null;
  if (!result) {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Counting your rating…
      </p>
    );
  }
  const you = state.status === "ready" ? state.you : null;
  return (
    <div className="space-y-2">
      <GeoRatingChange before={result.before[me]} after={result.after[me]} bot={view.ranked.bot} />
      {you && (
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {you.position !== null && (
            <span>
              Ladder <b className="text-foreground">#{fmt(you.position)}</b> of {fmt(you.players)}
            </span>
          )}
          <span>
            {you.wins}W · {you.losses}L
          </span>
          <Link href="/leaderboard?board=geo-ranked" className="underline underline-offset-2 hover:text-foreground">
            Ranked ladder
          </Link>
        </p>
      )}
    </div>
  );
}

/** On the ranked ladder: where you stand, even outside the top 100. */
export function YourGeoLadderSpot() {
  const { state } = useGeoRanked();
  if (state.status !== "ready") return null;
  const you = state.you;
  return (
    <Card className="border-warning/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        {you && you.games > 0 ? (
          <>
            <span className="flex items-center gap-3">
              <span className="font-pixel text-sm text-muted-foreground">#{fmt(you.position ?? 0)}</span>
              <GeoDivisionBadge elo={you.elo} />
            </span>
            <Record you={you} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You&apos;re not on the ladder yet.{" "}
            <Link href="/guessr#ranked" className="text-primary underline-offset-2 hover:underline">
              Play a ranked duel
            </Link>{" "}
            to get your division.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
