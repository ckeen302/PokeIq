"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Swords } from "lucide-react";
import type { ShareCard } from "@/lib/session-types";
import { MODULE_INFO } from "@/lib/modes";
import { QuizController } from "@/components/quiz/QuizController";
import { ResultGrid } from "@/components/quiz/ResultGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ChallengeLanding({ card, token, runLabel }: { card: ShareCard; token: string; runLabel: string }) {
  const [playing, setPlaying] = useState(false);
  const [round, setRound] = useState(0);
  const who = card.n || "A trainer";

  if (playing) {
    return (
      <div className="space-y-6">
        <p className="text-center text-sm text-muted-foreground">
          <Swords className="mr-1 inline h-4 w-4" /> Challenge from <b className="text-foreground">{who}</b> · {runLabel}
        </p>
        <QuizController
          key={round}
          request={{ challenge: token }}
          challenger={card}
          onRestart={() => setRound((r) => r + 1)}
        />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="mx-auto max-w-xl overflow-hidden">
        <div className="bg-gradient-to-br from-primary/20 via-transparent to-transparent p-6 text-center">
          <Swords className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-primary">You&apos;ve been challenged</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            {who} scored {card.c}/{card.t}
          </h1>
          <p className="text-muted-foreground">
            {runLabel} · PokéIQ <b className="text-foreground">{card.q}</b> · {card.sc.toLocaleString()} pts
          </p>
        </div>
        <CardContent className="space-y-6 p-6">
          <ResultGrid grid={card.gr} />
          <p className="text-center text-sm text-muted-foreground">
            You&apos;ll get the exact same {MODULE_INFO[card.m].title.toLowerCase()} questions, difficulty and format.
            Think you know Pokémon better?
          </p>
          <Button size="lg" className="w-full text-base" onClick={() => setPlaying(true)}>
            Accept challenge
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
