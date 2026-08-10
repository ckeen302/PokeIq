"use client";

/**
 * Category-agnostic quiz runtime.
 *
 * Modes:
 *  - classic:  10 sealed questions at a chosen difficulty
 *  - survival: 3 lives, difficulty ramps easy → medium → hard, batches of
 *              questions stream in ahead of the player until they fall
 *
 * Verification is server-side (sealed answer tokens); the client only ever
 * sees the verdict. Full keyboard play: 1–4 answer, Enter advance, M mute.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientQuestion, LeaderboardCategory } from "@/engines/types";
import { difficultyMultiplier, timerSeconds } from "@/engines/types";
import { Countdown } from "@/components/Countdown";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isMuted, play, setMuted, vibrate } from "@/lib/sound";
import { typeColor } from "@/lib/type-colors";
import { cn } from "@/lib/utils";
import { CircularTimer } from "./CircularTimer";
import { Confetti } from "./Confetti";
import { QuizImage } from "./QuizImage";
import { QuizResults, type AnswerRecord, type QuizSummary } from "./QuizResults";

const QUESTION_COUNT = 10;
const SURVIVAL_BATCH = 6;
const SURVIVAL_LIVES = 3;
const TICK_MS = 100;

type Phase = "intro" | "loading" | "playing" | "revealed" | "finished" | "error";
type Mode = "classic" | "survival" | "daily";
type QuizDifficulty = "easy" | "medium" | "hard" | "mixed";

export interface DailyInfo {
  dayNumber: number;
  endsAt: string;
}

interface Verdict {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

const DIFFICULTY_CARDS: Array<{
  level: QuizDifficulty;
  icon: string;
  blurb: string;
  detail: string;
}> = [
  { level: "easy", icon: "🌱", blurb: "Gen 1–2 icons", detail: "18s · 1× points" },
  { level: "medium", icon: "⚔️", blurb: "Deeper cuts", detail: "15s · 1.5× points" },
  { level: "hard", icon: "💀", blurb: "For champions", detail: "12s · 2× points" },
  { level: "mixed", icon: "🎲", blurb: "A bit of everything", detail: "The classic run" },
];

const LOADING_LINES = [
  "Computing questions live from PokéAPI…",
  "Rolling encounter tables…",
  "Consulting Professor Oak…",
  "Shuffling silhouettes…",
  "Alakazam is reading the data telepathically…",
];

const optionVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.07 * i, duration: 0.25 },
  }),
};

function preloadSprites(batch: ClientQuestion[]): void {
  for (const q of batch) {
    const urls = [q.imageUrl, ...Object.values(q.optionImages ?? {})].filter(
      Boolean,
    ) as string[];
    for (const url of urls) {
      const img = new window.Image();
      img.src = url;
    }
  }
}

export function QuizController({
  category,
  dailyInfo,
}: {
  category: LeaderboardCategory;
  dailyInfo?: DailyInfo;
}) {
  const isDaily = category === "daily";
  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<Mode>(isDaily ? "daily" : "classic");
  const [difficulty, setDifficulty] = useState<QuizDifficulty | "survival">(
    "mixed",
  );
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [lives, setLives] = useState(SURVIVAL_LIVES);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [selected, setSelected] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [score, setScore] = useState(0);
  const [lastGain, setLastGain] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [answeredMax, setAnsweredMax] = useState(0);
  const [streakBurst, setStreakBurst] = useState(0);
  const [loadingLine, setLoadingLine] = useState(0);
  const [muted, setMutedState] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const verifyingRef = useRef(false);
  const fetchingMoreRef = useRef(false);
  const survivalBatchRef = useRef(0);

  useEffect(() => setMutedState(isMuted()), []);

  const question: ClientQuestion | undefined = questions[index];
  const totalSeconds = question ? timerSeconds(question.difficulty) : 15;

  const fetchBatch = useCallback(
    async (batchDifficulty: QuizDifficulty, count: number) => {
      const res = await fetch(
        `/api/questions/${category}?count=${count}&difficulty=${batchDifficulty}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { questions: ClientQuestion[] };
      if (!data.questions?.length) throw new Error("No questions generated");
      preloadSprites(data.questions);
      return data.questions;
    },
    [category],
  );

  const resetRun = useCallback((batch: ClientQuestion[]) => {
    setQuestions(batch);
    setIndex(0);
    setScore(0);
    setLastGain(0);
    setStreak(0);
    setBestStreak(0);
    setHistory([]);
    setAnsweredMax(0);
    setSelected(null);
    setVerdict(null);
    setLives(SURVIVAL_LIVES);
    setSecondsLeft(timerSeconds(batch[0].difficulty));
    setPhase("playing");
  }, []);

  const startClassic = useCallback(
    async (chosen: QuizDifficulty) => {
      setPhase("loading");
      setMode("classic");
      setDifficulty(chosen);
      try {
        resetRun(await fetchBatch(chosen, QUESTION_COUNT));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Something went wrong",
        );
        setPhase("error");
      }
    },
    [fetchBatch, resetRun],
  );

  const startSurvival = useCallback(async () => {
    setPhase("loading");
    setMode("survival");
    setDifficulty("survival");
    survivalBatchRef.current = 1;
    try {
      resetRun(await fetchBatch("easy", SURVIVAL_BATCH));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong",
      );
      setPhase("error");
    }
  }, [fetchBatch, resetRun]);

  const startDaily = useCallback(async () => {
    setPhase("loading");
    setMode("daily");
    setDifficulty("mixed");
    try {
      const res = await fetch("/api/daily");
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { questions: ClientQuestion[] };
      if (!data.questions?.length) throw new Error("No questions generated");
      preloadSprites(data.questions);
      resetRun(data.questions);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong",
      );
      setPhase("error");
    }
  }, [resetRun]);

  // Survival: keep the queue topped up ahead of the player.
  useEffect(() => {
    if (
      mode !== "survival" ||
      phase === "intro" ||
      phase === "finished" ||
      fetchingMoreRef.current ||
      questions.length === 0 ||
      index < questions.length - 3
    ) {
      return;
    }
    fetchingMoreRef.current = true;
    const ramp: QuizDifficulty =
      survivalBatchRef.current === 1
        ? "medium"
        : survivalBatchRef.current === 2
          ? "hard"
          : "hard";
    survivalBatchRef.current += 1;
    void fetchBatch(ramp, SURVIVAL_BATCH)
      .then((batch) => {
        setQuestions((existing) => {
          const seen = new Set(existing.map((q) => q.question));
          return [...existing, ...batch.filter((q) => !seen.has(q.question))];
        });
      })
      .catch(() => {
        // Refill failed (network/PokéAPI hiccup) — the run simply ends
        // when the current queue is exhausted.
      })
      .finally(() => {
        fetchingMoreRef.current = false;
      });
  }, [mode, phase, index, questions.length, fetchBatch]);

  const submitAnswer = useCallback(
    async (answer: string) => {
      if (!question || verifyingRef.current || phase !== "playing") return;
      verifyingRef.current = true;
      setSelected(answer);
      const remaining = secondsLeft;
      try {
        const verifyUrl = isDaily ? "/api/daily" : `/api/questions/${category}`;
        const res = await fetch(verifyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: question.token, answer }),
        });
        if (!res.ok) throw new Error(`verify failed: ${res.status}`);
        const result = (await res.json()) as Verdict;
        setVerdict(result);
        setPhase("revealed");
        setHistory((h) => [
          ...h,
          {
            question: question.question,
            selected: answer,
            correctAnswer: result.correctAnswer,
            correct: result.correct,
            difficulty: question.difficulty,
          },
        ]);
        setAnsweredMax(
          (m) => m + Math.round(15 * difficultyMultiplier(question.difficulty)),
        );
        if (result.correct) {
          const speedBonus = Math.round(
            (5 * Math.max(0, remaining)) / totalSeconds,
          );
          const points = Math.round(
            (10 + speedBonus) * difficultyMultiplier(question.difficulty),
          );
          setScore((s) => s + points);
          setLastGain(points);
          setStreak((s) => {
            const next = s + 1;
            setBestStreak((b) => Math.max(b, next));
            if (next > 0 && next % 5 === 0) {
              setStreakBurst(next);
              play("streak");
            } else {
              play("correct");
            }
            return next;
          });
          vibrate([12, 40, 12]);
        } else {
          setStreak(0);
          setLastGain(0);
          play("wrong");
          vibrate(80);
          if (mode === "survival") setLives((l) => Math.max(0, l - 1));
        }
      } catch {
        setVerdict({
          correct: false,
          correctAnswer: "",
          explanation: "Could not verify this answer (network issue).",
        });
        setPhase("revealed");
      } finally {
        verifyingRef.current = false;
      }
    },
    [category, isDaily, mode, phase, question, secondsLeft, totalSeconds],
  );

  const advance = useCallback(() => {
    const dead = mode === "survival" && lives <= 0;
    if (dead || index + 1 >= questions.length) {
      play("fanfare");
      setPhase("finished");
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setSelected(null);
    setVerdict(null);
    setSecondsLeft(timerSeconds(questions[nextIndex].difficulty));
    setPhase("playing");
    containerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [index, lives, mode, questions]);

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      setMuted(!m);
      return !m;
    });
  }, []);

  // Countdown.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        const next = s - TICK_MS / 1000;
        if (next <= 0) {
          clearInterval(interval);
          void submitAnswer(""); // timed out
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, index, submitAnswer]);

  // Rotating loading flavor lines.
  useEffect(() => {
    if (phase !== "loading") return;
    const interval = setInterval(
      () => setLoadingLine((i) => (i + 1) % LOADING_LINES.length),
      1800,
    );
    return () => clearInterval(interval);
  }, [phase]);

  // Keyboard: 1–4 answer, Enter advance, M mute.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "m" || event.key === "M") {
        toggleMute();
        return;
      }
      if (phase === "playing" && question) {
        const num = Number(event.key);
        if (num >= 1 && num <= question.options.length) {
          event.preventDefault();
          void submitAnswer(question.options[num - 1]);
        }
      } else if (phase === "revealed" && event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, question, submitAnswer, advance, toggleMute]);

  /* ------------------------------------------------------------ */
  /* Screens                                                       */
  /* ------------------------------------------------------------ */

  if (phase === "intro" || phase === "error") {
    if (isDaily) {
      return (
        <Card className="mx-auto w-full max-w-xl text-center">
          {phase === "error" && (
            <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
              {errorMessage}
            </p>
          )}
          <div className="text-4xl" aria-hidden>
            🗓️
          </div>
          <h2 className="mt-2 text-2xl font-black">
            Daily Gauntlet{dailyInfo ? ` #${dailyInfo.dayNumber}` : ""}
          </h2>
          <p className="mt-2 text-sm text-muted">
            10 seeded questions across all four modules — identical for every
            trainer on Earth today. One board. One day. No excuses.
          </p>
          {dailyInfo && (
            <p className="mt-4 text-sm text-muted">
              Next gauntlet in{" "}
              <Countdown
                endsAt={dailyInfo.endsAt}
                className="font-mono font-bold text-sky-300"
              />
            </p>
          )}
          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => void startDaily()}
          >
            Start today&apos;s gauntlet
          </Button>
        </Card>
      );
    }
    return (
      <Card className="mx-auto w-full max-w-xl text-center">
        {phase === "error" && (
          <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
            {errorMessage}
          </p>
        )}
        <h2 className="text-2xl font-bold">Pick your challenge</h2>
        <p className="mt-1.5 text-sm text-muted">
          {QUESTION_COUNT} live-generated questions · keys 1–4 answer, Enter advances
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3">
          {DIFFICULTY_CARDS.map(({ level, icon, blurb, detail }, i) => (
            <motion.button
              key={level}
              custom={i}
              variants={optionVariants}
              initial="hidden"
              animate="visible"
              onClick={() => void startClassic(level)}
              className={cn(
                "glass group rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-white/10",
                level === "mixed" && "glow-ring",
              )}
            >
              <div className="text-2xl" aria-hidden>
                {icon}
              </div>
              <div className="mt-2 font-bold capitalize">{level}</div>
              <div className="mt-0.5 text-xs text-muted">{blurb}</div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wide text-sky-300/80">
                {detail}
              </div>
            </motion.button>
          ))}
        </div>
        <motion.button
          custom={4}
          variants={optionVariants}
          initial="hidden"
          animate="visible"
          onClick={() => void startSurvival()}
          className="group relative mt-3 w-full overflow-hidden rounded-2xl border border-red-400/25 bg-gradient-to-r from-red-500/15 via-orange-500/10 to-red-500/15 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-red-400/50"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 font-bold">
                <span aria-hidden>🔥</span> Survival
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                  Endless
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                3 lives · difficulty ramps up · how far can you go?
              </div>
            </div>
            <span aria-hidden className="text-2xl">
              ❤️❤️❤️
            </span>
          </div>
        </motion.button>
      </Card>
    );
  }

  if (phase === "loading") {
    return (
      <Card
        className="mx-auto flex w-full max-w-xl flex-col items-center py-16"
        aria-busy
      >
        <div className="relative">
          <div className="psychic-rings" aria-hidden />
          <div className="pokeball-spinner" aria-hidden />
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={loadingLine}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mt-6 text-sm text-muted"
          >
            {LOADING_LINES[loadingLine]}
          </motion.p>
        </AnimatePresence>
      </Card>
    );
  }

  if (phase === "finished") {
    const summary: QuizSummary = {
      score,
      maxPossible: answeredMax,
      correctCount: history.filter((h) => h.correct).length,
      totalQuestions: history.length,
      bestStreak,
      difficulty,
      mode,
      dayNumber: dailyInfo?.dayNumber,
    };
    return (
      <QuizResults
        category={category}
        summary={summary}
        history={history}
        onPlayAgain={() => setPhase("intro")}
      />
    );
  }

  if (!question) return null;

  const hasImages =
    question.optionImages &&
    question.options.every((o) => question.optionImages?.[o]);
  const isDuel = hasImages && question.options.length === 2;
  const progressTotal =
    mode === "survival" ? Math.max(questions.length, history.length + 1) : questions.length;

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-xl scroll-mt-24">
      {streakBurst > 0 && <Confetti key={streakBurst} />}

      {/* HUD */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="capitalize">{question.difficulty}</Badge>
          {mode === "survival" && (
            <span
              className="text-sm tracking-tight"
              aria-label={`${lives} lives remaining`}
            >
              {Array.from({ length: SURVIVAL_LIVES }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "inline-block transition-all",
                    i >= lives && "opacity-25 grayscale",
                  )}
                >
                  ❤️
                </span>
              ))}
            </span>
          )}
          <AnimatePresence>
            {streak >= 2 && (
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
              >
                <Badge tone="success">🔥 {streak}</Badge>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute sounds (M)" : "Mute sounds (M)"}
            className="rounded-full bg-white/5 p-2 text-sm transition-colors hover:bg-white/10"
          >
            <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
          </button>
          <div className="relative">
            <motion.span
              key={score}
              initial={{ scale: 1.35 }}
              animate={{ scale: 1 }}
              className="font-mono text-xl font-bold tabular-nums"
              aria-label={`Score ${score}`}
            >
              {score}
            </motion.span>
            <AnimatePresence>
              {phase === "revealed" && lastGain > 0 && (
                <motion.span
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: -14 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  className="absolute -right-1 -top-3 font-mono text-xs font-bold text-emerald-300"
                >
                  +{lastGain}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <CircularTimer
            secondsLeft={phase === "revealed" ? 0 : secondsLeft}
            totalSeconds={totalSeconds}
          />
        </div>
      </div>

      {/* Progress: per-question notches (classic) / rolling window (survival) */}
      <div
        className="mb-5 flex gap-1.5"
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={progressTotal}
        aria-label={
          mode === "survival"
            ? `Question ${index + 1}, survival mode`
            : `Question ${index + 1} of ${questions.length}`
        }
      >
        {(mode === "survival"
          ? Array.from({ length: Math.min(progressTotal, 20) }, (_, i) => i)
          : questions.map((_, i) => i)
        ).map((i) => {
          const record = history[i];
          return (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-300",
                record
                  ? record.correct
                    ? "bg-emerald-400"
                    : "bg-red-400/80"
                  : i === index
                    ? "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]"
                    : "bg-white/10",
              )}
            />
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -48 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <Card className={cn("sm:p-8", streak >= 5 && "streak-aura")}>
            <h2 className="text-balance text-lg font-bold leading-snug sm:text-xl">
              {question.question}
            </h2>

            {question.imageUrl && (
              <div className="mt-5">
                <QuizImage
                  src={question.imageUrl}
                  hint={
                    phase === "revealed" && question.imageHint === "silhouette"
                      ? "normal" // dramatic reveal
                      : question.imageHint
                  }
                  burst={question.imageHint === "silhouette"}
                />
              </div>
            )}

            {/* Options */}
            <div
              className={cn(
                "mt-6 gap-3",
                isDuel
                  ? "relative grid grid-cols-2"
                  : hasImages
                    ? "grid grid-cols-2"
                    : "grid",
              )}
              role="listbox"
              aria-label="Answer options"
            >
              {isDuel && (
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-background px-2.5 py-1 font-mono text-xs font-black text-amber-300"
                >
                  VS
                </span>
              )}
              {question.options.map((option, i) => {
                const isSelected = selected === option;
                const isCorrect =
                  phase === "revealed" && verdict?.correctAnswer === option;
                const isWrongPick =
                  phase === "revealed" && isSelected && !verdict?.correct;
                const sprite = question.optionImages?.[option];
                const dotColor = typeColor(option);

                return (
                  <motion.button
                    key={option}
                    custom={i}
                    variants={optionVariants}
                    initial="hidden"
                    animate="visible"
                    disabled={phase === "revealed"}
                    onClick={() => void submitAnswer(option)}
                    className={cn(
                      "glass rounded-2xl text-left text-sm font-medium transition-colors",
                      hasImages
                        ? "flex flex-col items-center gap-2 p-4"
                        : "flex min-h-12 items-center gap-3 px-4 py-3",
                      phase === "playing" &&
                        "hover:bg-white/10 active:scale-[0.98]",
                      isCorrect &&
                        "animate-correct border-emerald-400/70 bg-emerald-500/15",
                      isWrongPick &&
                        "animate-shake border-red-400/70 bg-red-500/15",
                      phase === "revealed" &&
                        !isCorrect &&
                        !isWrongPick &&
                        "opacity-50",
                    )}
                  >
                    {sprite && (
                      <span
                        className={cn(
                          "relative block w-full",
                          isDuel ? "aspect-square" : "aspect-square max-h-28",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sprite}
                          alt=""
                          className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.4)]"
                          loading="eager"
                        />
                      </span>
                    )}
                    <span
                      className={cn(
                        "flex items-center gap-2",
                        hasImages && "justify-center text-center",
                      )}
                    >
                      <kbd
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 font-mono text-xs",
                          isCorrect && "bg-emerald-400/30",
                          isWrongPick && "bg-red-400/30",
                        )}
                      >
                        {i + 1}
                      </kbd>
                      {dotColor && (
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: dotColor }}
                        />
                      )}
                      <span className={cn(!hasImages && "flex-1")}>{option}</span>
                      {isCorrect && <span aria-hidden>✓</span>}
                      {isWrongPick && <span aria-hidden>✗</span>}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            <AnimatePresence>
              {phase === "revealed" && verdict && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    role="status"
                    className={cn(
                      "mt-6 rounded-2xl border p-4 text-sm",
                      verdict.correct
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                        : "border-red-400/20 bg-red-500/10 text-red-200",
                    )}
                  >
                    <p className="font-bold">
                      {verdict.correct
                        ? streak >= 3
                          ? `Correct! ${streak} in a row 🔥`
                          : "Correct!"
                        : mode === "survival" && lives <= 0
                          ? "Game over!"
                          : selected
                            ? "Not quite."
                            : "Time's up!"}
                    </p>
                    <p className="mt-1.5 leading-relaxed text-foreground/90">
                      {verdict.explanation}
                    </p>
                  </div>
                  <Button className="mt-4 w-full" size="lg" onClick={advance}>
                    {mode === "survival" && lives <= 0
                      ? "See results"
                      : mode === "classic" && index + 1 >= questions.length
                        ? "See results"
                        : "Next question"}
                    <span className="text-xs opacity-60">(Enter)</span>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
