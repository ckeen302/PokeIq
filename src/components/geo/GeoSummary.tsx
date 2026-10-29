"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Copy, Link2, RotateCcw, Trophy } from "lucide-react";
import { geoBoardKey, type GeoChallenge } from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useProgress } from "@/lib/progress";
import { copyText, guessrShareText, shareOrCopy, shareUrl, type GuessrShareResult } from "@/lib/share";
import { GEO_DIFFICULTY_NAMES } from "@/lib/geo-difficulty";
import { COMPARE_MAX, COMPARE_MIN_PLAYERS, bucketOf, percentBeaten, type GeoDailyStats } from "@/lib/geo-compare";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { ShareButton } from "@/components/share/ShareButton";
import { GeoMap } from "./GeoMap";
import { cn } from "@/lib/utils";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { type Game, type Played, type Reward, emoji, fmt, maxTotal, placeName, post, useCountUp } from "./GeoGame";

/** The end-of-game summary; `compact` leaves the headline, map and round list to the results map it sits under. */
export function GeoSummary({
  game,
  played,
  resultToken,
  challengeToken,
  challenge,
  reward,
  onRestart,
  compact,
}: {
  game: Pick<Game, "region" | "kind" | "rounds" | "daily" | "practice" | "filter" | "guessGame" | "difficulty">;
  played: Played[];
  resultToken?: string;
  challengeToken?: string;
  challenge?: GeoChallenge;
  reward: Reward | null;
  onRestart: () => void;
  compact?: boolean;
}) {
  const progress = useProgress();
  const { region } = game;
  const isStreak = game.kind === "streak";
  const total = played.reduce((s, p) => s + p.graded.score, 0);
  const bonus = game.guessGame ? (played.at(-1)?.graded.bonusTotal ?? 0) : null;
  const streak = played.filter((p) => p.graded.hit).length;
  const headline = useCountUp(isStreak ? streak : total, 1100);
  const [name, setName] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shared, setShared] = useState<"done" | "failed" | null>(null);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareResult: GuessrShareResult = {
    game: "guessr",
    ...(game.daily ? { daily: dailyNumber(game.daily) } : {}),
    region: region.id,
    ...(isStreak ? { streak } : { rounds: played.map((p) => p.graded.score) }),
  };
  const challengeUrl = challengeToken ? `${origin}/guessr/c/${encodeURIComponent(challengeToken)}` : null;
  const canRank = !game.practice && !!resultToken;
  const modeName = game.difficulty ? GEO_DIFFICULTY_NAMES[game.difficulty] : undefined;
  const shareTextFull = guessrShareText(shareResult, region.name, shareUrl(shareResult), { mode: modeName });
  // The card to copy: the result, then the challenge link (same places) when there is one, else the result page.
  const shareBody = guessrShareText(shareResult, region.name, undefined, { mode: modeName });
  const shareLink = challengeUrl ?? shareUrl(shareResult);

  async function shareChallenge() {
    if (!challengeUrl) return;
    const outcome = await shareOrCopy(`I scored ${fmt(total)} in PokéGuessr. Same ${played.length || 5} places, can you beat me?`, challengeUrl);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(name)) {
      setSaveError(NAME_REJECTED);
      setSave("error");
      return;
    }
    setSave("saving");
    setSaveError(null);
    try {
      await post("/api/geo/leaderboard", { resultToken, playerName: name });
      setSave("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
      setSave("error");
    }
  }

  const theirs = challenge?.score ?? 0;
  const outcome = challenge ? (total > theirs ? "win" : total < theirs ? "lose" : "tie") : null;

  return (
    <div className={cn("mx-auto max-w-4xl space-y-6", compact && "space-y-4")}>
      <div className="space-y-2 text-center">
        {!compact && <p className="hud-label text-screen">{isStreak ? "Streak over" : "Survey complete"}</p>}
        {!compact && (
          <div className="font-display text-6xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.5)]">
            {isStreak ? `${headline} in a row` : fmt(headline)}
          </div>
        )}
        {!isStreak && (
          <>
            {!compact && <div className="text-sm text-muted-foreground">out of {fmt(maxTotal(game.rounds))}</div>}
            {bonus !== null && (
              <div className="text-sm font-semibold text-success" data-testid="geo-bonus-total">
                +{fmt(bonus)} game bonus · {fmt(total + bonus)} with the bonus (the leaderboard counts the map score)
              </div>
            )}
            {!compact && (
              <div className="meter mx-auto max-w-xl">
                <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(total / maxTotal(game.rounds)) * 100}%` }} transition={{ duration: 1.1 }} />
              </div>
            )}
          </>
        )}
        {reward && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {reward.best && <span className="rounded-sm border border-warning/50 px-2 py-1 font-pixel text-[10px] text-warning">New best</span>}
          </div>
        )}
      </div>

      {game.daily && !isStreak && <DailyCompare date={game.daily} score={total} />}

      {outcome && challenge && (
        <Card className={cn(outcome === "win" ? "border-success/50" : outcome === "lose" ? "border-destructive/40" : "")}>
          <CardContent className="space-y-3 p-5">
            <p className="text-center font-display text-2xl font-bold uppercase">
              {outcome === "win" ? `You beat ${challenge.name || "them"}!` : outcome === "lose" ? `${challenge.name || "They"} wins this one` : "Dead heat!"}
            </p>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-sm">
              <span />
              <span className="hud-label text-right">You</span>
              <span className="hud-label text-right">{challenge.name || "Them"}</span>
              {played.map((p, i) => (
                <div key={i} className="contents">
                  <span className="font-pixel text-xs text-muted-foreground">R{i + 1}</span>
                  <span className={cn("text-right tabular-nums", p.graded.score >= (challenge.rounds[i] ?? 0) && "font-bold text-success")}>
                    {fmt(p.graded.score)}
                  </span>
                  <span className={cn("text-right tabular-nums", (challenge.rounds[i] ?? 0) > p.graded.score && "font-bold text-success")}>
                    {fmt(challenge.rounds[i] ?? 0)}
                  </span>
                </div>
              ))}
              <span className="font-pixel text-xs">Total</span>
              <span className="text-right font-bold tabular-nums">{fmt(total)}</span>
              <span className="text-right font-bold tabular-nums">{fmt(theirs)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!isStreak && !compact && (
        <GeoMap region={region} revealed={played.map((p, i) => ({ guess: p.guess, answer: p.graded.answer, label: String(i + 1) }))} />
      )}

      <Card>
        <CardContent className="space-y-5 p-5">
          {reward && reward.newBadges.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 rounded-md border border-warning/40 bg-warning/[0.06] p-3">
              {reward.newBadges.map((b) => (
                <span key={b.id} className="flex items-center gap-2 text-sm">
                  <BadgeMedal id={b.id} size="md" />
                  <span>
                    <span className="block font-semibold">Badge unlocked: {b.name}</span>
                    <span className="text-xs text-muted-foreground">{b.description}</span>
                  </span>
                </span>
              ))}
            </div>
          )}

          <ol className={cn("space-y-2", compact && "hidden")} aria-hidden={compact || undefined}>
            {played.map((p, i) => (
              <li key={i} className="flex items-center gap-3 rounded-md border bg-shade/20 px-3 py-2">
                <span className="font-pixel text-xs text-muted-foreground">{i + 1}</span>
                <span aria-hidden>{isStreak ? (p.graded.hit ? "✅" : "❌") : emoji(p.graded.score)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{placeName(p.graded.answer, region)}</span>
                  <span className="text-muted-foreground"> · {p.graded.answer.game}</span>
                  {p.graded.gameGuess?.correct && <span className="text-success"> · +{fmt(p.graded.gameGuess.bonus)}</span>}
                </span>
                {!isStreak && <span className="font-pixel text-xs tabular-nums">{fmt(p.graded.score)}</span>}
              </li>
            ))}
          </ol>

          <ShareCard body={shareBody} link={shareLink} challenge={!!challengeUrl} />

          <div className="grid gap-2 sm:grid-cols-2">
            {challengeUrl && (
              <Button className="sm:col-span-2" size="lg" variant="success" onClick={() => void shareChallenge()}>
                <Link2 className="h-4 w-4" aria-hidden />
                {shared === "done" ? "Challenge link copied!" : "Challenge a friend"}
              </Button>
            )}
            <ShareButton size="lg" variant="outline" kind="guessr" label="Share…" getText={() => shareTextFull} className={cn(compact && "sm:col-span-2")} />
            {/* The results map above has its own Play again. */}
            {!compact && (
              <Button size="lg" variant="secondary" onClick={onRestart}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Play again
              </Button>
            )}
          </div>
          {shared === "failed" && challengeUrl && <CopyFallback text={challengeUrl} />}

          {canRank ? (
            <form className="space-y-2" onSubmit={submit}>
              <label htmlFor="geo-name" className="hud-label">
                Save to the leaderboard
              </label>
              <div className="flex gap-2">
                <input
                  id="geo-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaveError(null);
                  }}
                  maxLength={24}
                  required
                  placeholder="Trainer name"
                  disabled={save === "saved"}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button type="submit" disabled={save === "saving" || save === "saved" || !name.trim()}>
                  {save === "saved" ? "Saved" : "Submit"}
                </Button>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              )}
            </form>
          ) : game.practice === "repeat-daily" ? (
            <p className="text-xs text-muted-foreground">Only your first daily game of the day goes on the leaderboard.</p>
          ) : game.practice === "challenge" ? (
            <p className="text-xs text-muted-foreground">Challenge games aren&apos;t ranked, since the places were shared.</p>
          ) : game.practice === "filtered" ? (
            <p className="text-xs text-muted-foreground">Games on hand-picked games are practice: play All games, Classic 2D or Modern 3D to rank.</p>
          ) : game.practice === "difficulty" ? (
            <p className="text-xs text-muted-foreground">Easy and Hard games are practice: play Normal to get on the leaderboard.</p>
          ) : null}

          <Link
            href={
              game.daily
                ? `/leaderboard?board=geo&date=${game.daily}`
                : `/leaderboard?board=geo&format=${geoBoardKey({ region: region.id, kind: game.kind, era: game.filter.era, rounds: game.rounds })}`
            }
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
          >
            <Trophy className="h-4 w-4" aria-hidden /> Leaderboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The Wordle-style result card: the share text as it'll paste (a square per
 * round by how close the pin landed, each round's points, the total), with a
 * Copy button. The link copied under it is the challenge link when there is
 * one (the same places for a friend), else the result page.
 */
function ShareCard({ body, link, challenge }: { body: string; link: string; challenge: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const full = `${body}\n${link}`;
  async function copy() {
    const ok = await copyText(full);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setState("idle"), 2200);
  }
  return (
    <div className="space-y-2 rounded-md border bg-shade/20 p-3" data-testid="geo-share-card">
      <div className="flex items-center justify-between gap-3">
        <p className="hud-label">Your result card</p>
        <Button size="sm" variant={state === "copied" ? "success" : "secondary"} onClick={() => void copy()} data-testid="geo-copy-result">
          {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {state === "copied" ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed" data-testid="geo-share-preview">
        {body}
      </pre>
      <p className="truncate text-xs text-muted-foreground">
        {challenge ? "+ your challenge link: friends play the same places" : "+ a link to your result"}
      </p>
      {state === "failed" && <CopyFallback text={full} />}
    </div>
  );
}

/**
 * The Daily's "how you compared": the day's ranked scores in ten bars, yours
 * lit, and the share of players you beat. Shown only with enough players
 * (geo_runs: games saved to the daily leaderboard); otherwise nothing.
 */
function DailyCompare({ date, score }: { date: string; score: number }) {
  const [stats, setStats] = useState<GeoDailyStats | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/geo/daily-stats?date=${encodeURIComponent(date)}&score=${score}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoDailyStats>) : null))
      .then((s) => !off && setStats(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [date, score]);
  if (!stats || stats.players < COMPARE_MIN_PLAYERS) return null;
  const beaten = percentBeaten(stats);
  const mine = bucketOf(score);
  const tallest = Math.max(1, ...stats.buckets);
  return (
    <Card data-testid="geo-daily-compare">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="hud-label text-warning">How you compared</p>
          <p className="text-sm text-muted-foreground">
            {fmt(stats.players)} ranked players today{stats.median !== undefined ? ` · median ${fmt(stats.median)}` : ""}
          </p>
        </div>
        {beaten !== null && (
          <p className="font-display text-2xl font-bold uppercase" data-testid="geo-daily-percent">
            Better than {beaten}% of players
          </p>
        )}
        <div className="flex h-28 items-end gap-1" role="img" aria-label={`Score spread for the day, your score in bar ${mine + 1} of ${stats.buckets.length}`}>
          {stats.buckets.map((n, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-stretch justify-end">
              {i === mine && <span className="mb-1 text-center font-pixel text-[9px] uppercase text-primary">You</span>}
              <motion.div
                className={cn("rounded-t-sm", i === mine ? "bg-primary" : "bg-muted-foreground/30")}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(n ? 6 : 2, (n / tallest) * 82)}%` }}
                transition={{ duration: 0.6, delay: i * 0.03 }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between font-pixel text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{fmt(COMPARE_MAX / 2)}</span>
          <span>{fmt(COMPARE_MAX)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
