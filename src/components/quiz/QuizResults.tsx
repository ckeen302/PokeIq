"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import confetti from "canvas-confetti";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { track } from "@vercel/analytics";
import { Check, Link2, Loader2, RotateCcw, Swords, Trophy } from "lucide-react";
import type { PracticeReason, RunResult, ShareCard } from "@/lib/session-types";
import { iqInterval, iqTitle } from "@/lib/rating";
import { currentStreak, levelInfo, recordRun, setTrainerName, useProgress, type RunReward } from "@/lib/progress";
import { challengeUrl, resultShareText, shareOrCopy, shareText } from "@/lib/share";
import { ShareButton } from "@/components/share/ShareButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResultGrid } from "./ResultGrid";
import { coachInsights } from "@/lib/coach";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { play } from "@/lib/sound";
import { IqConvergence } from "./IqConvergence";
import { CopyFallback } from "./CopyFallback";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { cn } from "@/lib/utils";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";

interface QuizResultsProps {
  result: RunResult;
  resultToken: string;
  shareToken: string;
  challenger?: ShareCard;
  onRestart: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "failed" | "disabled";

const PRACTICE_NOTES: Record<PracticeReason, string> = {
  challenge: "Practice run — challenge replays don't go on the leaderboard.",
  "repeat-daily": "Practice run — only your first Daily Challenge of the day goes on the leaderboard.",
  filtered: "Practice run — generation-filtered runs aren't ranked; boards compare all-generation runs.",
};

/** Runs already credited this page-life (guards against re-mounts double-counting XP). */
const recorded = new Map<string, RunReward>();

function gradeFor(accuracy: number) {
  if (accuracy >= 90) return { grade: "S", color: "text-primary", message: "Champion material!" };
  if (accuracy >= 75) return { grade: "A", color: "text-success", message: "Elite Four level." };
  if (accuracy >= 60) return { grade: "B", color: "text-success", message: "Gym Leader worthy." };
  if (accuracy >= 40) return { grade: "C", color: "text-muted-foreground", message: "Keep training!" };
  return { grade: "D", color: "text-muted-foreground", message: "Back to Pallet Town…" };
}

export function QuizResults({ result, resultToken, shareToken, challenger, onRestart }: QuizResultsProps) {
  const progress = useProgress();
  const [reward, setReward] = useState<RunReward | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<"idle" | "copied">("idle");
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const firedRef = useRef(false);

  const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  const { grade, color, message } = gradeFor(accuracy);
  const isDaily = Boolean(result.spec.daily);
  const isAdaptive = result.spec.format === "adaptive";
  const practice = result.practice ?? result.spec.practice;
  const interval = isAdaptive && result.se !== undefined ? iqInterval(result.rating, result.se) : null;

  // Credit XP / streaks / badges exactly once per run.
  useEffect(() => {
    const existing = recorded.get(result.sid);
    if (existing) return setReward(existing);
    const r = recordRun(result, shareToken);
    recorded.set(result.sid, r);
    setReward(r);
  }, [result, shareToken]);

  useEffect(() => {
    if (progress?.name && !playerName) setPlayerName(progress.name);
  }, [progress?.name, playerName]);

  // Animated count-ups.
  const iqValue = useMotionValue(70);
  const iqDisplay = useTransform(iqValue, (v) => Math.round(v));
  const scoreValue = useMotionValue(0);
  const scoreDisplay = useTransform(scoreValue, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const a = animate(iqValue, result.pokeiq, { duration: 1.4, ease: "easeOut" });
    const b = animate(scoreValue, result.score, { duration: 1.1, ease: "easeOut" });
    return () => {
      a.stop();
      b.stop();
    };
  }, [result.pokeiq, result.score, iqValue, scoreValue]);

  useEffect(() => {
    if (firedRef.current || accuracy < 60) return;
    firedRef.current = true;
    play("fanfare");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#fbbf24", "#f59e0b", "#22c55e", "#3b82f6"];
    confetti({ particleCount: 90, spread: 75, origin: { y: 0.3 }, colors, disableForReducedMotion: true });
    if (accuracy >= 90) {
      setTimeout(() => {
        confetti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.5 }, colors });
        confetti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.5 }, colors });
      }, 350);
    }
  }, [accuracy]);

  /** Score, time and a square per answer; the link is the run's /c/ challenge (same questions, signed score). */
  function shareTextNow(): string {
    const day = result.spec.daily;
    const streak = day && progress ? currentStreak(progress.daily.last, progress.daily.streak, day) : undefined;
    return resultShareText(result, challengeUrl(shareToken), streak);
  }

  async function copyChallenge() {
    const text = `Think you know Pokémon? I scored ${result.correct}/${result.total} (PokéIQ ${result.pokeiq}). Beat me:`;
    const url = challengeUrl(shareToken);
    const outcome = await shareOrCopy(text, url);
    if (outcome === "failed") return setCopyFallback(shareText(text, url));
    if (outcome !== "cancelled") {
      setCopyFallback(null);
      setLinkState("copied");
      track("challenge_create");
      setTimeout(() => setLinkState("idle"), 2500);
    }
  }

  async function submitScore() {
    const name = playerName.trim();
    if (!name || practice || saveState === "saving" || saveState === "saved") return;
    if (!isCleanName(name)) {
      setSaveError(NAME_REJECTED);
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    setTrainerName(name);
    try {
      const res = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: name, resultToken }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setSaveState(body.saved ? "saved" : "disabled");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
      setSaveState("failed");
    }
  }

  const beatChallenger =
    challenger && (result.score > challenger.sc ? "win" : result.score === challenger.sc ? "tie" : "loss");

  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
      <Card className="mx-auto w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-foreground/[0.07] bg-shade/30 px-6 py-3">
          <span className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 text-screen" /> {isAdaptive ? "PokéIQ Test complete" : "Run complete"}
          </span>
          <span className="hud-label">
            {result.correct}/{result.total} correct
          </span>
        </div>
        <CardHeader className="items-center space-y-5 text-center">
          <h2 className="font-display text-3xl font-bold uppercase tracking-tight">
            {isAdaptive ? `You're a${/^[AEIOU]/.test(iqTitle(result.pokeiq)) ? "n" : ""} ${iqTitle(result.pokeiq)}` : message}
          </h2>
          <div className="grid w-full max-w-md grid-cols-[auto_1fr_1fr] gap-3">
            {!isAdaptive && (
              <div className="screen flex w-20 flex-col items-center justify-center rounded-md">
                <span className="hud-label relative z-[3]">Rank</span>
                <motion.span
                  className={cn("relative z-[3] font-display text-5xl font-bold", color)}
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 }}
                >
                  {grade}
                </motion.span>
              </div>
            )}
            <div className={cn("screen rounded-md px-4 py-3 text-left", isAdaptive && "col-span-2")}>
              <div className="hud-label relative z-[3]">PokéIQ</div>
              <motion.div className="relative z-[3] font-display text-5xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.6)]">
                {iqDisplay}
              </motion.div>
              <div className="relative z-[3] text-[11px] text-muted-foreground">
                {interval ? `90% range ${interval[0]}–${interval[1]}` : iqTitle(result.pokeiq)}
              </div>
            </div>
            <div className="screen rounded-md px-4 py-3 text-left">
              <div className="hud-label relative z-[3]">Score</div>
              <motion.div className="relative z-[3] font-pixel text-2xl tabular-nums leading-[3rem] text-foreground">{scoreDisplay}</motion.div>
              <div className="relative z-[3] text-[11px] text-muted-foreground">Best streak {result.bestStreak}</div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {result.trajectory && <IqConvergence trajectory={result.trajectory} grid={result.grid} />}
          <ResultGrid grid={result.grid} />

          {challenger && (
            <div
              className={cn(
                "rounded-lg border p-4 text-center",
                beatChallenger === "win" ? "border-success/50 bg-success/10" : "border-foreground/10 bg-muted/40"
              )}
            >
              <div className="flex items-center justify-center gap-2 text-sm font-semibold">
                <Swords className="h-4 w-4" aria-hidden />
                {beatChallenger === "win" ? "You won the challenge!" : beatChallenger === "tie" ? "It's a tie!" : "Challenge lost — rematch?"}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="font-semibold">You</div>
                  <div className="tabular-nums text-muted-foreground">
                    {result.score.toLocaleString()} pts · {result.correct}/{result.total} · IQ {result.pokeiq}
                  </div>
                </div>
                <div>
                  <div className="font-semibold">{challenger.n || "Challenger"}</div>
                  <div className="tabular-nums text-muted-foreground">
                    {challenger.sc.toLocaleString()} pts · {challenger.c}/{challenger.t} · IQ {challenger.q}
                  </div>
                </div>
              </div>
            </div>
          )}

          {reward && (
            <motion.div
              className="flex flex-wrap items-center justify-center gap-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <Badge variant="secondary">+{reward.xp} XP</Badge>
              {reward.levelAfter > reward.levelBefore && <Badge>Level up! Lv {reward.levelAfter}</Badge>}
              {reward.dailyStreak !== undefined && <Badge variant="success">🔥 {reward.dailyStreak}-day streak</Badge>}
              {reward.newBadges.map((b) => (
                <Badge key={b.id} variant="outline" className="border-warning/60 text-warning">
                  <BadgeMedal id={b.id} size="sm" /> {b.name} unlocked
                </Badge>
              ))}
            </motion.div>
          )}
          {progress && (() => {
            const focus = coachInsights(progress.skills ?? {}).weak[0];
            return focus ? (
              <Link
                href={focus.href}
                className="flex items-center justify-between gap-3 rounded-md border border-screen/30 bg-screen/[0.05] px-4 py-3 text-sm transition hover:bg-screen/10"
              >
                <span>
                  <span className="text-muted-foreground">Coach tip: your weakest area is </span>
                  <b>{focus.label}</b> <span className="text-muted-foreground">(~{Math.round(focus.accuracy * 100)}%)</span>
                </span>
                <span className="shrink-0 font-semibold text-screen">{focus.cta} →</span>
              </Link>
            ) : null;
          })()}
          {progress && (
            <div className="space-y-1">
              <div className="hud-label flex justify-between">
                <span>Trainer level {levelInfo(progress.xp).level}</span>
                <span>{levelInfo(progress.xp).toNext} XP to next</span>
              </div>
              <div className="meter">
                <motion.div
                  className="h-full bg-screen shadow-[0_0_8px_hsl(var(--screen))]"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo(progress.xp).progress * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                />
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <ShareButton size="lg" kind={isDaily ? "daily" : isAdaptive ? "iq-test" : "run"} getText={shareTextNow} />
            <Button size="lg" variant="outline" onClick={copyChallenge}>
              {linkState === "copied" ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {linkState === "copied" ? "Challenge link copied!" : "Challenge a friend"}
            </Button>
          </div>

          {copyFallback && <CopyFallback text={copyFallback} />}

          {isDaily && <NextDailyCountdown label="Next Daily Challenge in" />}

          {practice ? (
            <p className="rounded-md border border-dashed px-4 py-3 text-center text-xs text-muted-foreground">{PRACTICE_NOTES[practice]}</p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="player-name" className="hud-label">
                {isDaily ? "Post to today's daily leaderboard" : "Save to leaderboard"}
              </label>
              <div className="flex gap-2">
                <input
                  id="player-name"
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (saveState === "failed") setSaveState("idle");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submitScore()}
                  maxLength={24}
                  placeholder="Trainer name"
                  disabled={saveState === "saved" || saveState === "disabled"}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button
                  onClick={submitScore}
                  disabled={!playerName.trim() || saveState === "saving" || saveState === "saved" || saveState === "disabled"}
                >
                  {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {saveState === "saved" ? "Saved!" : "Submit"}
                </Button>
              </div>
              {saveState === "failed" && (
                <p role="alert" className="text-xs text-destructive">
                  {saveError}
                </p>
              )}
              {saveState === "disabled" && (
                <p className="text-xs text-muted-foreground">Leaderboards aren&apos;t enabled on this deployment.</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {!isDaily && (
              <Button className="flex-1" size="lg" variant="secondary" onClick={onRestart}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Play again
              </Button>
            )}
            <Link
              href={
                isDaily
                  ? `/leaderboard?board=daily&date=${result.spec.daily}`
                  : result.spec.format === "adaptive"
                    ? "/leaderboard?board=iq"
                    : `/leaderboard?board=${result.spec.module}&format=${result.spec.format}&difficulty=${result.spec.difficulty}`
              }
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "flex-1")}
            >
              <Trophy className="h-4 w-4" aria-hidden /> Leaderboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
