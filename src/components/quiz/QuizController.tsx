"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { CheckCircle2, Flame, Heart, RotateCcw, XCircle, Zap } from "lucide-react";
import type { AnswerResponse, PublicQuestion, ShareCard, StartResponse } from "@/lib/session-types";
import type { Difficulty, ModuleId, QuizFormat } from "@/engines/types";
import { getProgress, recordAnswer } from "@/lib/progress";
import { play, vibrate } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CircularTimer } from "./CircularTimer";
import { CryPlayer, ImageMedia } from "./QuestionMedia";
import { QuizResults } from "./QuizResults";
import { cn } from "@/lib/utils";

/**
 * <QuizController /> — the one quiz runtime behind every mode and format.
 *
 * It holds no answers: it renders the server's public question, posts the
 * player's choice with the signed session token, and renders whatever the
 * server graded. Classic / Survival / Blitz differ only in the rules the
 * server returns (question count, lives, per-question vs run timer).
 */

export type StartRequest =
  | { module: ModuleId; format: QuizFormat; difficulty: Difficulty; gens?: number[] }
  | { daily: string }
  | { challenge: string };

type Phase = "loading" | "error" | "active" | "submitting" | "revealed" | "complete";

interface QuizControllerProps {
  request: StartRequest;
  /** Challenger's card, for the head-to-head results screen. */
  challenger?: ShareCard;
  onRestart?: () => void;
}

const BLITZ_FLASH_MS = 450;

export function QuizController({ request, challenger, onRestart }: QuizControllerProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<StartResponse["rules"] | null>(null);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [graded, setGraded] = useState<AnswerResponse | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lives, setLives] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  const tokenRef = useRef("");
  const pendingNextRef = useRef<PublicQuestion | null>(null);
  const questionStartRef = useRef(0);
  const runStartRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const submittingRef = useRef(false);

  const isBlitz = rules?.runMs != null;
  const requestKey = JSON.stringify(request);

  // ---- start -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setError(null);
      const req = JSON.parse(requestKey) as StartRequest;
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...req, name: getProgress().name || undefined }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        if (cancelled) return;
        const start = body as StartResponse;
        tokenRef.current = start.token;
        setRules(start.rules);
        setQuestion(start.question);
        setLives(start.lives);
        setScore(0);
        setStreak(0);
        setAnswered(0);
        setGraded(null);
        setSelected(null);
        runStartRef.current = questionStartRef.current = Date.now();
        setPhase("active");
        track("quiz_start", { kind: "daily" in req ? "daily" : "challenge" in req ? "challenge" : req.module });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't start the quiz.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestKey, attempt]);

  // ---- answering ---------------------------------------------------------
  const submit = useCallback(
    async (choice: string | null) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSelected(choice);
      setPhase("submitting");
      try {
        const res = await fetch("/api/session/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: tokenRef.current,
            choice,
            playerRating: getProgress().rating ?? undefined,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        const result = body as AnswerResponse;
        tokenRef.current = result.token;
        pendingNextRef.current = result.next ?? null;
        setGraded(result);
        recordAnswer(result.tags ?? [], result.correct);
        if (result.correct) play(result.streak > 0 && result.streak % 5 === 0 ? "streak" : "correct");
        else {
          play("wrong");
          vibrate(60);
        }
        setScore(result.score);
        setStreak(result.streak);
        setLives(result.lives);
        setAnswered(result.answered);
        // Warm the browser cache for the next question's media.
        if (result.next?.media?.type === "image") new window.Image().src = result.next.media.url;

        setPhase("revealed");
        if (result.done) {
          track("quiz_complete", { correct: result.result?.correct ?? 0, total: result.result?.total ?? 0 });
          if (isBlitz) setTimeout(() => setPhase("complete"), 300);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't grade that answer.");
        setPhase("error");
      } finally {
        submittingRef.current = false;
      }
    },
    [isBlitz]
  );

  const advance = useCallback(() => {
    const next = pendingNextRef.current;
    if (!next) {
      setPhase((p) => (p === "revealed" ? "complete" : p));
      return;
    }
    pendingNextRef.current = null;
    setQuestion(next);
    setSelected(null);
    setGraded(null);
    questionStartRef.current = Date.now();
    setPhase("active");
    if (!isBlitz) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isBlitz]);

  // Blitz never pauses on a reveal: flash the result, move on.
  useEffect(() => {
    if (phase !== "revealed" || !isBlitz || graded?.done) return;
    const id = setTimeout(advance, BLITZ_FLASH_MS);
    return () => clearTimeout(id);
  }, [phase, isBlitz, graded, advance]);

  // ---- clocks -------------------------------------------------------------
  useEffect(() => {
    if (phase !== "active" && !(isBlitz && phase === "revealed")) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [phase, isBlitz]);

  const questionMsLeft =
    rules?.questionMs != null ? Math.max(0, rules.questionMs - (now - questionStartRef.current)) : null;
  const runMsLeft = rules?.runMs != null ? Math.max(0, rules.runMs - (now - runStartRef.current)) : null;

  useEffect(() => {
    if (phase !== "active") return;
    if ((questionMsLeft !== null && questionMsLeft <= 0) || (runMsLeft !== null && runMsLeft <= 0)) {
      void submit(null);
    }
  }, [phase, questionMsLeft, runMsLeft, submit]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      if (phase === "active" && question) {
        const n = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? 2 : Number(e.key);
        if (n >= 1 && n <= question.options.length) void submit(question.options[n - 1]);
      } else if (phase === "revealed" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, question, graded, submit, advance]);

  // ---- render -------------------------------------------------------------
  if (phase === "loading") return <LoadingCard />;

  if (phase === "error") {
    return (
      <Card className="mx-auto w-full max-w-2xl border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => setAttempt((a) => a + 1)}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Start a new run
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "complete" && graded?.result) {
    return (
      <QuizResults
        result={graded.result}
        resultToken={graded.resultToken!}
        shareToken={graded.shareToken!}
        challenger={challenger}
        onRestart={onRestart ?? (() => setAttempt((a) => a + 1))}
      />
    );
  }

  if (!question || !rules) return null;
  const revealed = phase === "revealed";
  const isCards = Boolean(question.cards?.length);

  return (
    <Card ref={cardRef} className="mx-auto w-full max-w-2xl scroll-mt-24 overflow-hidden">
      {runMsLeft !== null && (
        <div className="h-1.5 w-full bg-secondary" aria-hidden>
          <div
            className={cn("h-full transition-[width] duration-100 ease-linear", runMsLeft < 10_000 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${(runMsLeft / rules.runMs!) * 100}%` }}
          />
        </div>
      )}
      <CardHeader className="space-y-0 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {rules.total ? `${Math.min(answered + (revealed ? 0 : 1), rules.total)} / ${rules.total}` : `#${question.index + 1}`}
            </Badge>
            {lives !== null && (
              <span className="flex items-center gap-0.5" aria-label={`${lives} lives left`}>
                {Array.from({ length: rules.lives ?? 0 }).map((_, i) => (
                  <motion.span key={i} animate={{ scale: i < lives ? 1 : 0.8, opacity: i < lives ? 1 : 0.25 }}>
                    <Heart className={cn("h-4 w-4", i < lives ? "fill-destructive text-destructive" : "text-muted-foreground")} />
                  </motion.span>
                ))}
              </span>
            )}
            <AnimatePresence>
              {streak > 1 && (
                <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                  <Badge variant="success" className="gap-1">
                    <Flame className="h-3 w-3" aria-hidden /> {streak}
                  </Badge>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="relative">
              <Badge className="tabular-nums">{score.toLocaleString()} pts</Badge>
              <AnimatePresence>
                {revealed && graded && graded.gained > 0 && (
                  <motion.span
                    key={`gain-${question.index}`}
                    className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-success"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                  >
                    +{graded.gained}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          {questionMsLeft !== null ? (
            <CircularTimer progress={questionMsLeft / rules.questionMs!} secondsLeft={Math.ceil(questionMsLeft / 1000)} />
          ) : runMsLeft !== null ? (
            <div className={cn("flex items-center gap-1 font-mono text-lg font-bold tabular-nums", runMsLeft < 10_000 && "text-destructive")}>
              <Zap className="h-4 w-4" aria-hidden />
              {Math.ceil(runMsLeft / 1000)}s
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        <AnimatePresence mode="wait">
          <motion.div
            key={question.index}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: isBlitz ? 0.15 : 0.26, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <h2 className="text-xl font-semibold leading-snug">{question.prompt}</h2>
              {question.detail && (
                <p
                  className={cn(
                    "text-muted-foreground",
                    question.module === "dex" && question.detail.startsWith("“")
                      ? "rounded-lg border border-white/5 bg-muted/50 p-4 font-serif text-[15px] italic leading-relaxed text-foreground/90"
                      : "text-sm"
                  )}
                >
                  {question.detail}
                </p>
              )}
            </div>

            {question.media?.type === "image" && (
              <ImageMedia
                key={question.media.url}
                src={question.media.url}
                revealSrc={graded?.revealUrl}
                silhouette={question.module === "whos-that"}
                revealed={revealed}
                label={revealed ? graded?.answer : undefined}
              />
            )}
            {question.media?.type === "audio" && (
              <>
                <CryPlayer key={question.media.url} src={question.media.url} />
                {revealed && graded?.revealUrl && (
                  <ImageMedia src={graded.revealUrl} silhouette={false} revealed={false} label={graded.answer} />
                )}
              </>
            )}

            {isCards ? (
              <div className="grid grid-cols-2 gap-3">
                {question.cards!.map((card, i) => {
                  const option = question.options[i];
                  return (
                    <AnswerTile
                      key={option}
                      index={i}
                      option={option}
                      phase={phase}
                      selected={selected}
                      graded={graded}
                      onPick={submit}
                    >
                      <div className="relative mx-auto aspect-square w-full max-w-[150px]">
                        <Image src={card.imageUrl} alt={card.label} fill priority sizes="150px" className="object-contain" />
                      </div>
                      <span className="text-center font-semibold">{card.label}</span>
                    </AnswerTile>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {question.options.map((option, i) => (
                  <AnswerTile
                    key={option}
                    index={i}
                    option={option}
                    phase={phase}
                    selected={selected}
                    graded={graded}
                    onPick={submit}
                  >
                    <span className="flex items-center gap-2">
                      <kbd
                        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold text-muted-foreground sm:inline-flex"
                        aria-hidden
                      >
                        {i + 1}
                      </kbd>
                      {option}
                    </span>
                  </AnswerTile>
                ))}
              </div>
            )}

            {revealed && graded && !isBlitz && (
              <motion.div className="space-y-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <p className={cn("text-sm font-semibold", graded.correct ? "text-success" : "text-destructive")}>
                  {graded.correct
                    ? streak >= 3
                      ? `Correct — ${streak} in a row!`
                      : "Correct!"
                    : selected === null
                      ? `Time's up! It was ${graded.answer}.`
                      : `Not quite — it was ${graded.answer}.`}
                </p>
                {graded.explanation && (
                  <p className="rounded-md border border-white/5 bg-muted/60 p-3 text-sm text-muted-foreground">
                    {graded.explanation}
                    {graded.learnHref && (
                      <>
                        {" "}
                        <Link href={graded.learnHref} target="_blank" className="font-medium text-primary hover:underline">
                          Study it in the Pokédex →
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <Button className="w-full" size="lg" onClick={advance}>
                  {graded.done ? "See results" : "Next question"}
                  <kbd className="hidden rounded border border-primary-foreground/30 px-1.5 text-[10px] sm:inline">⏎</kbd>
                </Button>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

interface AnswerTileProps {
  index: number;
  option: string;
  phase: Phase;
  selected: string | null;
  graded: AnswerResponse | null;
  onPick: (option: string) => void;
  children: React.ReactNode;
}

function AnswerTile({ index, option, phase, selected, graded, onPick, children }: AnswerTileProps) {
  const locked = phase !== "active";
  const isAnswer = graded?.answer === option;
  const isPicked = selected === option;
  const wrongPick = graded && isPicked && !graded.correct;

  return (
    <motion.button
      type="button"
      disabled={locked}
      onClick={() => onPick(option)}
      initial={{ opacity: 0, y: 12 }}
      animate={wrongPick ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, y: 0 }}
      transition={{ delay: graded ? 0 : 0.06 + index * 0.05, duration: wrongPick ? 0.4 : 0.28 }}
      whileTap={locked ? undefined : { scale: 0.97 }}
      className={cn(
        "flex min-h-12 w-full flex-col items-stretch justify-center gap-2 rounded-lg border bg-background/60 px-4 py-3 text-left text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !locked && "hover:border-primary/60 hover:bg-primary/5",
        phase === "submitting" && isPicked && "border-primary/70 bg-primary/10",
        graded && isAnswer && "border-success bg-success/15",
        wrongPick && "border-destructive bg-destructive/15",
        graded && !isAnswer && !isPicked && "opacity-60"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex-1">{children}</span>
        {graded && isAnswer && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct answer" />}
        {wrongPick && <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Your answer" />}
      </span>
    </motion.button>
  );
}

function LoadingCard() {
  return (
    <Card className="mx-auto w-full max-w-2xl overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <motion.span
            className="h-3 w-3 rounded-full bg-primary"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
            aria-hidden
          />
          <span className="text-sm text-muted-foreground">Shuffling the Pokédex…</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="mx-auto aspect-square w-full max-w-[280px] rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
