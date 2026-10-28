"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import { track } from "@vercel/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ANSWER_LABELS, type Answer, type Question } from "@/lib/which-pokemon/types";
import { RUN_LENGTH, drawQuestions, type Response } from "@/lib/which-pokemon/questions";
import { nextStep } from "@/lib/which-pokemon/run";
import { matchProfile, resultPath } from "@/lib/which-pokemon/match";
import { lastResult, saveLastResult } from "@/lib/which-pokemon/local";
import { cn } from "@/lib/utils";

/**
 * The quiz: one statement at a time, five thumb-sized answers, a progress
 * bar, and the result page the moment the last answer lands. Scoring and
 * matching run here in the browser; the result travels in the link.
 */

const ANSWERS: Answer[] = [1, 2, 3, 4, 5];
const TONE: Record<Answer, string> = {
  1: "hover:border-destructive/60",
  2: "hover:border-destructive/40",
  3: "hover:border-foreground/40",
  4: "hover:border-success/50",
  5: "hover:border-success/70",
};

export function WhichPokemonQuiz() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    const scores = lastResult();
    if (scores) {
      const m = matchProfile(scores);
      setLast(`${resultPath(m.top.pokemon.slug, scores)}`);
    }
  }, []);

  const start = useCallback(() => {
    setQuestions(drawQuestions(`${Date.now()}:${Math.random()}`));
    setResponses([]);
    track("which-pokemon", { event: "start" });
    // On a phone the page title would push the fifth answer below the fold.
    requestAnimationFrame(() => document.querySelector('[data-testid="wp-quiz"]')?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);

  const answer = useCallback(
    (value: Answer) => {
      if (!questions || finishing) return;
      const step = nextStep(questions, responses);
      if (step.done) return;
      const next = [...responses, { id: step.question.id, answer: value }];
      const after = nextStep(questions, next);
      setResponses(next);
      if (after.done) {
        setFinishing(true);
        const { result } = after;
        saveLastResult(result.scores);
        track("which-pokemon", { event: "result", pokemon: result.top.pokemon.slug });
        router.push(resultPath(result.top.pokemon.slug, result.scores));
      } else {
        // A tie-breaker may have been appended to the question list.
        setQuestions([...questions]);
      }
    },
    [questions, responses, finishing, router]
  );

  const back = useCallback(() => setResponses((r) => r.slice(0, -1)), []);

  useEffect(() => {
    if (!questions) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-5]$/.test(e.key)) answer(Number(e.key) as Answer);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions, answer]);

  if (!questions) {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardContent className="space-y-5 p-6 text-center">
          <p className="text-muted-foreground">
            {RUN_LENGTH} quick statements about life on the road. Rate each one from <b className="text-foreground">Not me at all</b> to{" "}
            <b className="text-foreground">Totally me</b>, and the Pokédex does the rest.
          </p>
          <Button size="lg" className="h-14 w-full text-base" onClick={start} data-testid="wp-start">
            <Sparkles className="h-5 w-5" aria-hidden /> Find my Pokémon
          </Button>
          <p className="hud-label">About two minutes · 200 possible results · no sign-up</p>
          {last && (
            <Link href={last} className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="wp-last">
              See your last result
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  const step = nextStep(questions, responses);
  if (step.done || finishing) {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardContent className="p-8 text-center" role="status">
          <p className="hud-label animate-pulse text-screen">Consulting the Pokédex…</p>
        </CardContent>
      </Card>
    );
  }

  const { question, index, total } = step;
  const tieBreaker = index >= RUN_LENGTH;
  return (
    <Card className="mx-auto w-full max-w-xl scroll-mt-20 overflow-hidden" data-testid="wp-quiz">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.07] bg-shade/30 px-4 py-3 sm:px-6">
        <span className="font-pixel text-xs tracking-wider text-muted-foreground">
          Q <span className="text-foreground">{String(index + 1).padStart(2, "0")}</span>/{total}
        </span>
        <span className="hud-label text-screen">{tieBreaker ? "Tie-breaker" : "Which Pokémon are you?"}</span>
      </div>
      <Progress value={(index / total) * 100} className="rounded-none" aria-label="Quiz progress" />
      <CardContent className="space-y-4 p-4 sm:p-6">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={question.id}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: 0.14 }}
            className="space-y-4"
          >
            <h2 className="dialog-box min-h-[5.5rem] text-balance text-lg font-semibold leading-snug sm:text-xl" data-testid="wp-question">
              {question.text}
            </h2>
            <div className="grid gap-2" role="group" aria-label="Your answer">
              {ANSWERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => answer(value)}
                  className={cn(
                    "menu-item flex h-12 w-full items-center justify-between rounded-md border bg-card px-4 text-left font-display text-[15px] font-semibold uppercase tracking-wide transition-colors active:bg-accent/60 sm:h-14",
                    TONE[value]
                  )}
                  data-testid="wp-answer"
                  data-answer={value}
                >
                  {ANSWER_LABELS[value]}
                  <span className="hud-label">{value}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={back} disabled={responses.length === 0} data-testid="wp-back">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <span className="hud-label">1–5 on the keyboard works too</span>
        </div>
      </CardContent>
    </Card>
  );
}
