"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { CheckCircle2, Flame, Heart, RotateCcw, XCircle } from "lucide-react";
import type { AnswerResponse, PublicQuestion, ShareCard, StartResponse } from "@/lib/session-types";
import type { Difficulty, ModuleId, QuizFormat } from "@/engines/types";
import { getProgress, recordAnswer } from "@/lib/progress";
import { play, vibrate } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogBox } from "@/components/game/DialogBox";
import { HpBar } from "@/components/game/HpBar";
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
  const timeFraction =
    questionMsLeft !== null ? questionMsLeft / rules.questionMs! : runMsLeft !== null ? runMsLeft / rules.runMs! : null;
  const secondsLeft = Math.ceil((questionMsLeft ?? runMsLeft ?? 0) / 1000);
  const isEntry = question.module === "dex" && question.detail?.startsWith("“");

  const verdict = graded
    ? graded.correct
      ? streak >= 3
        ? `Correct! That's ${streak} in a row!`
        : `Correct! It's ${graded.answer}!`
      : selected === null
        ? `Time's up! It was ${graded.answer}.`
        : `Not quite… it was ${graded.answer}.`
    : "";

  return (
    <Card ref={cardRef} className="mx-auto w-full max-w-2xl scroll-mt-24 overflow-hidden">
      {/* HUD */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-black/30 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <span className="font-pixel text-xs tracking-wider text-muted-foreground">
            {rules.total ? (
              <>
                Q <span className="text-foreground">{String(Math.min(answered + (revealed ? 0 : 1), rules.total)).padStart(2, "0")}</span>/
                {String(rules.total).padStart(2, "0")}
              </>
            ) : (
              <>
                No.<span className="text-foreground">{String(question.index + 1).padStart(3, "0")}</span>
              </>
            )}
          </span>
          {lives !== null && (
            <span className="flex items-center gap-1" aria-label={`${lives} lives left`}>
              {Array.from({ length: rules.lives ?? 0 }).map((_, i) => (
                <motion.span key={i} animate={{ scale: i < lives ? 1 : 0.75, opacity: i < lives ? 1 : 0.25 }}>
                  <Heart className={cn("h-4 w-4", i < lives ? "fill-primary text-primary" : "text-muted-foreground")} />
                </motion.span>
              ))}
            </span>
          )}
          <AnimatePresence>
            {streak > 1 && (
              <motion.span
                className="flex items-center gap-1 font-pixel text-xs text-warning"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
              >
                <Flame className="h-3.5 w-3.5" aria-hidden />x{streak}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="relative text-right">
          <div className="hud-label">Score</div>
          <div className="font-pixel text-base tabular-nums tracking-wider text-screen">{String(score).padStart(6, "0")}</div>
          <AnimatePresence>
            {revealed && graded && graded.gained > 0 && (
              <motion.span
                key={`gain-${question.index}`}
                className="absolute -left-12 top-3 font-pixel text-xs text-success"
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

      {timeFraction !== null && (
        <div className="flex items-center gap-3 px-4 pt-4 sm:px-6">
          <HpBar value={timeFraction} label={runMsLeft !== null ? "RUN" : "TIME"} className="flex-1" />
          <span className={cn("w-8 text-right font-pixel text-xs tabular-nums", timeFraction < 0.25 && "animate-blink text-destructive")}>
            {secondsLeft}
          </span>
        </div>
      )}

      <CardContent className="p-4 pt-4 sm:p-6 sm:pt-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={question.index}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: isBlitz ? 0.12 : 0.22, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="space-y-5"
          >
            <DialogBox as="h2" text={question.prompt} speed={isBlitz ? 0 : 12} />

            {question.detail &&
              (isEntry ? (
                <div className="screen rounded-md p-4">
                  <div className="hud-label relative z-[3] mb-2 text-screen">Pokédex entry</div>
                  <p className="relative z-[3] text-[15px] leading-relaxed text-foreground/90">{question.detail}</p>
                </div>
              ) : (
                <p className="hud-label normal-case tracking-wide text-muted-foreground">{question.detail}</p>
              ))}

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
                    <AnswerTile key={option} index={i} option={option} phase={phase} selected={selected} graded={graded} onPick={submit} card>
                      <div className="screen relative mx-auto aspect-square w-full max-w-[150px] rounded-md">
                        <Image src={card.imageUrl} alt={card.label} fill priority sizes="150px" className="relative z-[1] object-contain p-2" />
                      </div>
                      <span className="text-center">{card.label}</span>
                    </AnswerTile>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {question.options.map((option, i) => (
                  <AnswerTile key={option} index={i} option={option} phase={phase} selected={selected} graded={graded} onPick={submit}>
                    {option}
                  </AnswerTile>
                ))}
              </div>
            )}

            {revealed && graded && !isBlitz && (
              <motion.div className="space-y-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <DialogBox
                  text={verdict}
                  speed={10}
                  className={graded.correct ? "border-success/90" : "border-destructive/90"}
                >
                  {graded.explanation && (
                    <p className="text-sm text-muted-foreground">
                      {graded.explanation}
                      {graded.learnHref && (
                        <>
                          {" "}
                          <Link href={graded.learnHref} target="_blank" className="font-medium text-screen hover:underline">
                            Study it in the Pokédex →
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </DialogBox>
                <Button className="w-full" size="lg" onClick={advance}>
                  {graded.done ? "See results" : "Next question"} ▶
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
  card?: boolean;
  children: React.ReactNode;
}

/** Battle-menu option: ▶ cursor on hover, key hint, green/red on reveal. */
function AnswerTile({ index, option, phase, selected, graded, onPick, card, children }: AnswerTileProps) {
  const locked = phase !== "active";
  const isAnswer = graded?.answer === option;
  const isPicked = selected === option;
  const wrongPick = graded && isPicked && !graded.correct;

  return (
    <motion.button
      type="button"
      disabled={locked}
      onClick={() => onPick(option)}
      data-selected={phase === "submitting" && isPicked}
      initial={{ opacity: 0, y: 10 }}
      animate={wrongPick ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, y: 0 }}
      transition={{ delay: graded ? 0 : 0.05 + index * 0.04, duration: wrongPick ? 0.4 : 0.24 }}
      className={cn(
        "menu-item flex w-full flex-col items-stretch justify-center gap-2 rounded-md border-2 border-white/10 bg-black/30 px-4 text-left font-display text-[15px] font-semibold tracking-wide",
        card ? "py-3" : "min-h-[52px] py-2.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !locked && "hover:border-screen/60 hover:bg-screen/[0.06]",
        phase === "submitting" && isPicked && "border-screen/70 bg-screen/10",
        graded && isAnswer && "border-success bg-success/15 shadow-[0_0_18px_-6px_hsl(var(--success))]",
        wrongPick && "border-destructive bg-destructive/15",
        graded && !isAnswer && !isPicked && "opacity-50"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex-1">{children}</span>
        {graded && isAnswer ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct answer" />
        ) : wrongPick ? (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Your answer" />
        ) : (
          <kbd className="hidden font-pixel text-[10px] text-muted-foreground sm:inline" aria-hidden>
            [{index + 1}]
          </kbd>
        )}
      </span>
    </motion.button>
  );
}

function LoadingCard() {
  return (
    <Card className="mx-auto w-full max-w-2xl overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.07] bg-black/30 px-6 py-3">
        <span className="led animate-blink text-screen" />
        <span className="hud-label text-screen">Accessing Pokédex…</span>
      </div>
      <CardContent className="space-y-4 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="mx-auto aspect-square w-full max-w-[280px]" />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
