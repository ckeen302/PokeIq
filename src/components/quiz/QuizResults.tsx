"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LeaderboardCategory, QuizCategory } from "@/engines/types";
import { CATEGORY_META } from "@/engines/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { evaluateBadges, type BadgeDef } from "@/lib/achievements";
import { recordGame } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { BadgeToasts } from "./BadgeToasts";
import { Confetti } from "./Confetti";

export interface QuizSummary {
  score: number;
  maxPossible: number;
  correctCount: number;
  totalQuestions: number;
  bestStreak: number;
  difficulty: string;
  mode: "classic" | "survival" | "daily";
  dayNumber?: number;
}

export interface AnswerRecord {
  question: string;
  selected: string;
  correctAnswer: string;
  correct: boolean;
  difficulty: string;
}

type Grade = "S" | "A" | "B" | "C" | "D";

function gradeFor(score: number, maxPossible: number): Grade {
  const ratio = maxPossible > 0 ? score / maxPossible : 0;
  if (ratio >= 0.9) return "S";
  if (ratio >= 0.75) return "A";
  if (ratio >= 0.6) return "B";
  if (ratio >= 0.4) return "C";
  return "D";
}

const GRADE_STYLES: Record<Grade, { color: string; label: string }> = {
  S: { color: "text-amber-300", label: "Legendary!" },
  A: { color: "text-emerald-300", label: "Elite Four material" },
  B: { color: "text-sky-300", label: "Gym Leader tier" },
  C: { color: "text-indigo-300", label: "Solid trainer" },
  D: { color: "text-slate-400", label: "Back to Pallet Town" },
};

/** Animated 0 → score counter (skipped under reduced motion). */
function CountUpScore({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduceMotion || !ref.current) return;
    const controls = animate(0, value, {
      duration: 1.1,
      ease: "easeOut",
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduceMotion]);
  return <span ref={ref}>{reduceMotion ? value : 0}</span>;
}

function buildShareText(
  category: LeaderboardCategory,
  summary: QuizSummary,
  history: AnswerRecord[],
  grade: Grade,
): string {
  const emojiGrid = history.map((h) => (h.correct ? "🟩" : "🟥")).join("");
  let headline: string;
  if (summary.mode === "daily") {
    headline = `PokéIQ Daily #${summary.dayNumber ?? "?"} — Grade ${grade} · ${summary.score} pts 🔥${summary.bestStreak}`;
  } else if (summary.mode === "survival") {
    const meta = CATEGORY_META[category as QuizCategory];
    headline = `PokéIQ Survival — ${meta.name}: survived ${summary.correctCount} 🔥${summary.bestStreak}`;
  } else {
    const meta = CATEGORY_META[category as QuizCategory];
    headline = `PokéIQ — ${meta.name} (${summary.difficulty}): Grade ${grade} · ${summary.score} pts 🔥${summary.bestStreak}`;
  }
  return `${headline}\n${emojiGrid}\nEvery question computed live — no question banks.`;
}

export function QuizResults({
  category,
  summary,
  history,
  onPlayAgain,
}: {
  category: LeaderboardCategory;
  summary: QuizSummary;
  history: AnswerRecord[];
  onPlayAgain: () => void;
}) {
  const [name, setName] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [xpBanked, setXpBanked] = useState<{
    rank: number;
    of: number;
  } | null>(null);
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [persistent, setPersistent] = useState(true);
  const [shared, setShared] = useState(false);
  const [newBadges, setNewBadges] = useState<BadgeDef[]>([]);
  const recordedRef = useRef(false);

  // Persist trainer profile + evaluate badges exactly once per finished run.
  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    const runSummary = {
      category,
      mode: summary.mode,
      score: summary.score,
      correctCount: summary.correctCount,
      totalQuestions: summary.totalQuestions,
      bestStreak: summary.bestStreak,
    };
    recordGame(runSummary);
    // Sync to the signed-in account too (server 401s harmlessly for guests).
    fetch("/api/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runSummary),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rank?: { rank: number; of: number } | null } | null) => {
        if (data?.rank) setXpBanked(data.rank);
      })
      .catch(() => null);
    setNewBadges(
      evaluateBadges({
        mode: summary.mode,
        difficulty: summary.difficulty,
        score: summary.score,
        maxPossible: summary.maxPossible,
        correctCount: summary.correctCount,
        totalQuestions: summary.totalQuestions,
        bestStreak: summary.bestStreak,
      }),
    );
  }, [category, summary]);

  // Signed-in players post scores under their trainer name automatically.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user: { username: string } | null } | null) => {
        if (!cancelled && data?.user) {
          setAccount(data.user.username);
          setName(data.user.username);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const grade = gradeFor(summary.score, summary.maxPossible);
  const gradeStyle = GRADE_STYLES[grade];
  const accuracy =
    summary.totalQuestions > 0
      ? Math.round((100 * summary.correctCount) / summary.totalQuestions)
      : 0;
  const isSurvival = summary.mode === "survival";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || submitState === "sending") return;
    setSubmitState("sending");
    try {
      const res = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          score: summary.score,
          streak: summary.bestStreak,
          difficulty: summary.difficulty,
        }),
      });
      if (!res.ok) throw new Error(`submit failed: ${res.status}`);
      const data = (await res.json()) as { persistent: boolean };
      setPersistent(data.persistent);
      setSubmitState("done");
    } catch {
      setSubmitState("error");
    }
  }

  async function share() {
    const text = buildShareText(category, summary, history, grade);
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      {(grade === "S" || grade === "A") && <Confetti />}
      <BadgeToasts badges={newBadges} />

      <Card className="text-center sm:p-8">
        {isSurvival ? (
          <motion.div
            initial={{ scale: 2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
          >
            <div className="text-6xl" aria-hidden>
              🔥
            </div>
            <p className="mt-3 text-2xl font-black">
              Survived {summary.correctCount}{" "}
              {summary.correctCount === 1 ? "question" : "questions"}
            </p>
          </motion.div>
        ) : (
          <>
            <motion.div
              initial={{ scale: 2.4, opacity: 0, rotate: -14 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 15,
                delay: 0.2,
              }}
              className={cn(
                "mx-auto inline-block rounded-2xl border-4 border-current px-6 py-2 text-7xl font-black",
                gradeStyle.color,
              )}
              aria-label={`Grade ${grade}`}
            >
              {grade}
            </motion.div>
            <p className={cn("mt-3 text-sm font-semibold", gradeStyle.color)}>
              {gradeStyle.label}
            </p>
          </>
        )}

        <p className="mt-4 font-mono text-5xl font-black tabular-nums">
          <CountUpScore value={summary.score} />
          <span className="text-lg font-normal text-muted"> pts</span>
        </p>

        <div className="mx-auto mt-6 grid max-w-sm grid-cols-3 gap-3">
          {[
            { value: `${accuracy}%`, label: "Accuracy" },
            {
              value: `${summary.correctCount}/${summary.totalQuestions}`,
              label: "Correct",
            },
            { value: `${summary.bestStreak}🔥`, label: "Best streak" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white/5 p-3">
              <div className="font-mono text-lg font-bold">{stat.value}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Badge className="capitalize">
            {summary.mode === "daily"
              ? `Daily Gauntlet #${summary.dayNumber ?? ""}`
              : isSurvival
                ? "Survival mode"
                : `Difficulty: ${summary.difficulty}`}
          </Badge>
        </div>

        {xpBanked && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1.5 text-sm font-semibold text-indigo-200"
          >
            <span aria-hidden>⚡</span>+{summary.score} XP banked · Global rank
            #{xpBanked.rank} of {xpBanked.of}
          </motion.p>
        )}

        {submitState !== "done" ? (
          <form onSubmit={submit} className="mt-7 flex gap-2">
            {account ? (
              <span className="glass flex h-11 flex-1 items-center rounded-xl px-4 text-sm font-semibold text-indigo-200">
                {account}
              </span>
            ) : (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="Your trainer name"
                aria-label="Trainer name for leaderboard"
                className="glass h-11 flex-1 rounded-xl px-4 text-sm placeholder:text-muted focus:outline-none"
              />
            )}
            <Button
              type="submit"
              disabled={!name.trim() || submitState === "sending"}
            >
              {submitState === "sending" ? "Saving…" : "Save score"}
            </Button>
          </form>
        ) : (
          <p className="mt-7 text-sm text-emerald-300">
            Score saved{persistent ? "" : " (session-only — no database configured)"}!
          </p>
        )}
        {submitState === "error" && (
          <p className="mt-2 text-sm text-red-300">
            Could not save your score. Try again in a moment.
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={onPlayAgain} size="lg">
            Play again
          </Button>
          <Button variant="outline" size="lg" onClick={() => void share()}>
            {shared ? "Copied! ✓" : "Share result"}
          </Button>
          <Link href="/leaderboard">
            <Button variant="ghost" size="lg">
              Leaderboard
            </Button>
          </Link>
        </div>
      </Card>

      {history.length > 0 && (
        <Card className="mt-5">
          <h3 className="font-bold">Run review</h3>
          <ol className="mt-4 space-y-2">
            {history.map((record, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 text-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    record.correct
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-red-500/20 text-red-300",
                  )}
                >
                  {record.correct ? "✓" : "✗"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground/90">{record.question}</p>
                  <p className="mt-1 text-xs text-muted">
                    {record.correct ? (
                      <>
                        Answered:{" "}
                        <span className="text-emerald-300">{record.selected}</span>
                      </>
                    ) : (
                      <>
                        {record.selected ? (
                          <>
                            You picked{" "}
                            <span className="text-red-300">{record.selected}</span>{" "}
                            ·{" "}
                          </>
                        ) : (
                          <>Timed out · </>
                        )}
                        Correct:{" "}
                        <span className="text-emerald-300">
                          {record.correctAnswer}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <Badge className="shrink-0 capitalize">{record.difficulty}</Badge>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
