"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Crosshair, Gauge, Play } from "lucide-react";
import { QuizController } from "@/components/quiz/QuizController";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { iqTitle, ratingToIQ } from "@/lib/rating";
import { useProgress } from "@/lib/progress";

const STEPS = [
  { icon: Crosshair, title: "It adapts to you", text: "Get one right and the next is harder; miss and it eases off. Every question is chosen to be the most informative one for your level." },
  { icon: Gauge, title: "Measured, not counted", text: "Your PokéIQ comes from which questions you answered, not just how many — with an honest 90% confidence range." },
  { icon: Brain, title: "Everything is fair game", text: "Silhouettes, Pokédex entries, type matchups and stat battles from every generation. 20 questions, 20 seconds each." },
];

export function IqTest() {
  const progress = useProgress();
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = progress?.rating != null ? ratingToIQ(progress.rating) : null;

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">The PokéIQ Test</p>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          How much do you <span className="text-shimmer">really</span> know?
        </h1>
        <p className="text-muted-foreground">
          An adaptive test — the same technique the GRE and GMAT use — that homes in on your level in 20 questions.
        </p>
      </div>

      {playing ? (
        <QuizController
          key={round}
          request={{ module: "mixed", format: "adaptive", difficulty: "medium" }}
          onRestart={() => setRound((r) => r + 1)}
        />
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {STEPS.map(({ icon: Icon, title, text }, i) => (
                  <motion.div
                    key={title}
                    className="space-y-2 rounded-xl border bg-muted/30 p-4"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                  >
                    <Icon className="h-5 w-5 text-primary" />
                    <div className="text-sm font-semibold">{title}</div>
                    <p className="text-xs text-muted-foreground">{text}</p>
                  </motion.div>
                ))}
              </div>
              {current !== null && (
                <p className="text-center text-sm text-muted-foreground">
                  Your current PokéIQ: <b className="text-foreground">{current}</b> ({iqTitle(current)}). Retaking refines it.
                </p>
              )}
              <Button size="lg" className="w-full text-base" onClick={() => setPlaying(true)}>
                <Play className="h-5 w-5" /> Start the test
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Expect to get roughly 60–75% right — that&apos;s the test working, not you failing.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
