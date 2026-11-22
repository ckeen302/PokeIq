"use client";

import { useEffect, useId, useState } from "react";
import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { Loader2, Medal, Trophy } from "lucide-react";
import { CONN_LEVELS, CONN_MAX_MISTAKES, type ConnBoardRow, type ConnBoardStanding } from "@/lib/connections/types";
import { isCleanName } from "@/lib/name-filter";
import type { BadgeDef } from "@/lib/progress";
import { clock } from "@/lib/share";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BeatMyTime, FriendsBoard } from "./social";
import { useT } from "@/i18n/client";
import communityNs from "@/messages/community";
import { translator, type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import conn from "@/messages/connections";
import badgesNs from "@/messages/badges";

type ConnT = Translator<typeof conn.en>;

/** PokéConnections' results-screen extras: the celebration, the streak flame, tomorrow, badges and the daily leaderboard. */

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const COLOURS = CONN_LEVELS.map((l) => l.hex);

/** Confetti in the four group colours: a burst for a solve, and a bigger, two-sided one for a perfect game. */
export function useCelebration(kind: "perfect" | "solved" | null) {
  useEffect(() => {
    if (!kind || reduced()) return;
    let t: number | undefined;
    let live = true;
    // Loaded on the win itself: the board doesn't wait for it.
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (!live) return;
      confetti({ particleCount: kind === "perfect" ? 110 : 60, spread: 80, origin: { y: 0.35 }, colors: COLOURS, disableForReducedMotion: true });
      if (kind !== "perfect") return;
      t = window.setTimeout(() => {
        confetti({ particleCount: 70, angle: 60, spread: 65, origin: { x: 0, y: 0.6 }, colors: COLOURS, disableForReducedMotion: true });
        confetti({ particleCount: 70, angle: 120, spread: 65, origin: { x: 1, y: 0.6 }, colors: COLOURS, disableForReducedMotion: true });
      }, 380);
    });
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [kind]);
}

/** "PERFECT!": each letter pops in, in the four group colours. */
export function PerfectBanner() {
  const t = useT(conn);
  const letters = [...t("perfect.word")];
  return (
    <div className="flex justify-center gap-0.5 font-display text-5xl font-bold uppercase tracking-tight sm:text-6xl" role="status" aria-label={t("perfect.aria")} data-testid="conn-perfect">
      {letters.map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden
          initial={{ y: 24, opacity: 0, scale: 0.4, rotate: -12 }}
          animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 14, delay: 0.05 * i }}
          style={{ color: COLOURS[i % 4], textShadow: `0 0 22px ${COLOURS[i % 4]}66` }}
        >
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

/** The line under the streak: a record only once there is a run to speak of. */
export function streakNote(streak: number, best: number, t: ConnT = translator(conn, "en", undefined)): string {
  if (streak <= 1 && best <= 1) return t("streak.keepGoing");
  return streak >= best ? t("streak.best") : t("streak.bestDays", { n: best });
}

/** The streak, with a flickering flame that grows with it. */
export function StreakFlame({ streak, best }: { streak: number; best: number }) {
  const t = useT(conn);
  const size = streak >= 30 ? "text-5xl" : streak >= 7 ? "text-4xl" : "text-3xl";
  return (
    <div className="flex items-center justify-center gap-3 rounded-lg border border-orange-400/40 bg-orange-400/[0.08] px-4 py-3" data-testid="conn-streak">
      <motion.span
        aria-hidden
        className={cn("inline-block origin-bottom", size)}
        animate={reduced() ? undefined : { scale: [1, 1.12, 0.96, 1.08, 1], rotate: [0, -4, 3, -2, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        🔥
      </motion.span>
      <div className="text-left">
        <p className="font-display text-2xl font-bold tabular-nums leading-none text-orange-400">
          {t("streak.days", { n: streak })}
        </p>
        <p className="text-xs text-muted-foreground">{streakNote(streak, best, t)}</p>
      </div>
    </div>
  );
}

/** "Come back tomorrow" with the countdown to the next daily. */
export function ComeBackTomorrow({ next }: { next: number }) {
  const t = useT(conn);
  return (
    <div className="space-y-1 rounded-lg border border-screen/40 bg-screen/[0.06] px-4 py-3 text-center" data-testid="conn-tomorrow">
      <p className="font-display text-base font-bold uppercase tracking-wide">{t("tomorrow", { n: next })}</p>
      <NextDailyCountdown label={t("newPuzzleIn")} />
    </div>
  );
}

/** Badges this game just earned. */
export function NewBadges({ badges }: { badges: BadgeDef[] }) {
  const t = useT(conn);
  const bt = useT(badgesNs);
  if (!badges.length) return null;
  return (
    <div className="space-y-2" data-testid="conn-badges">
      <p className="hud-label text-warning">{t("newBadges", { n: badges.length })}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {badges.map((b, i) => (
          <motion.div
            key={b.id}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 16, delay: 0.25 + i * 0.12 }}
            className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/[0.08] px-3 py-2 text-left"
          >
            <BadgeMedal id={b.id} />
            <span>
              <span className="block text-sm font-semibold">{(bt.locale === "en" ? b.name : bt(`${b.id as keyof typeof badgesNs.en & string}.name`))}</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">{(bt.locale === "en" ? b.description : bt(`${b.id as keyof typeof badgesNs.en & string}.description`))}</span>
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Why a finished daily isn't on the board, in words. */
const unranked = (t: ConnT, why: Exclude<ConnBoardStanding, { position: number }>["unranked"]): string =>
  why === "unsolved" ? t("board.unsolved") : why === "untimed" ? t("board.untimed") : why === "name-taken" ? t("board.nameTaken") : why === "limited" ? t("board.limited") : "";

/**
 * Today's leaderboard on the results screen: the top ten (fewest mistakes,
 * then fastest), your place, and, for a trainer with no name yet, a name to
 * rank under.
 */
export function DailyLeaderboard({
  date,
  standing,
  rows,
  you,
  onName,
}: {
  date: string;
  standing: ConnBoardStanding | null;
  rows: ConnBoardRow[] | null;
  /** The name you rank under, to find your row. */
  you: string | null;
  onName: (name: string) => Promise<void>;
}) {
  const t = useT(conn);
  const ct = useT(communityNs);
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "friends">("all");
  if (!standing || (("unranked" in standing) && standing.unranked === "off") || rows === null) return null;
  const needsName = "unranked" in standing && (standing.unranked === "no-name" || standing.unranked === "name-taken");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!isCleanName(n)) return setError(ct("nameRejected"));
    setBusy(true);
    setError(null);
    await onName(n);
    setBusy(false);
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-left" aria-labelledby={`${id}-h`} data-testid="conn-board">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`${id}-h`} className="flex items-center gap-1.5 font-display text-base font-bold uppercase tracking-wide">
          <Trophy className="h-4 w-4 text-warning" aria-hidden /> {t("board.title")}
        </h3>
        <Link href={`/leaderboard?board=connections&date=${date}`} className="text-xs text-primary hover:underline">
          {t("board.full")}
        </Link>
      </div>
      <div role="tablist" className="flex gap-1.5" aria-label={t("board.tabs")}>
        {(["all", "friends"] as const).map((k) => (
          <Button key={k} role="tab" size="sm" variant={tab === k ? "default" : "outline"} aria-selected={tab === k} className="h-7 px-3 text-xs" onClick={() => setTab(k)} data-testid={`conn-board-tab-${k}`}>
            {k === "all" ? t("board.everyone") : t("board.friends")}
          </Button>
        ))}
      </div>
      {tab === "friends" ? (
        <FriendsBoard date={date} refreshKey={standing} />
      ) : (
        <>
      {"position" in standing ? (
        <p className="text-sm" data-testid="conn-board-place">
          {t.rich("board.place", { position: standing.position, total: formatNumber(standing.total, t.locale), b: (c) => <b>{c}</b> })}
        </p>
      ) : needsName ? (
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor={`${id}-n`} className="block text-sm">
            {standing.unranked === "name-taken" ? t("board.nameTakenPick") : t("board.addName")}
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-n`}
              value={name}
              onChange={(e) => (setName(e.target.value), setError(null))}
              maxLength={24}
              placeholder={t("board.placeholder")}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("board.rankMe")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{unranked(t, standing.unranked)}</p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("board.empty")}</p>
      ) : (
        <ol className="divide-y text-sm">
          {rows.map((r, i) => {
            const mine = you !== null && r.name.toLowerCase() === you.toLowerCase();
            return (
              <li key={`${r.name}-${i}`} className={cn("flex items-center gap-3 py-1.5", mine && "-mx-2 rounded-md bg-primary/10 px-2 font-semibold")}>
                <span className="w-6 text-right font-mono tabular-nums text-muted-foreground">
                  {i < 3 ? <Medal className={cn("ml-auto h-4 w-4", ["text-yellow-400", "text-slate-300", "text-amber-600"][i])} aria-label={t("board.medal", { n: i + 1 })} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  {r.hinted && (
                    <span title={t("board.usedHint")} aria-label={t("board.usedHintAria")}>
                      {" "}
                      💡
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground" title={t("board.mistakesTitle", { n: r.mistakes, max: CONN_MAX_MISTAKES })}>
                  {r.mistakes === 0 ? t("board.perfect") : t("board.mistakes", { n: r.mistakes })}
                </span>
                <span className="w-12 text-right font-mono tabular-nums">{clock(r.ms / 1000)}</span>
              </li>
            );
          })}
        </ol>
      )}
        </>
      )}
      {"position" in standing && <BeatMyTime date={date} />}
    </section>
  );
}

/** The keyboard shortcuts, small, for keyboards only. */
export function KeyHints() {
  const t = useT(conn);
  const k = "rounded border border-foreground/20 bg-shade/30 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80";
  const kbd = (c: React.ReactNode[]) => <kbd className={k}>{c}</kbd>;
  return (
    <p className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground [@media(hover:hover)]:flex" data-testid="conn-keys">
      <span>
        {t.rich("keys.pick", { k: kbd })}
      </span>
      <span>
        {t.rich("keys.submit", { k: kbd })}
      </span>
      <span>
        {t.rich("keys.shuffle", { k: kbd })}
      </span>
      <span>
        {t.rich("keys.deselect", { k: kbd })}
      </span>
      <span>
        {t.rich("keys.move", { k: kbd })}
      </span>
    </p>
  );
}
