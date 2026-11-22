"use client";

import { BackButtonClient as BackButton } from "@/components/ui/BackButtonClient";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "@/components/ui/Link";
import { CalendarDays, Swords } from "lucide-react";
import type { ShareCard } from "@/lib/session-types";
import { QuizController } from "@/components/quiz/QuizController";
import { ResultGrid } from "@/components/quiz/ResultGrid";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { num } from "@/components/quiz/num";
import { useT } from "@/i18n/client";
import challengeNs from "@/messages/quiz-challenge";
import modesNs from "@/messages/quiz-modes";
import { unlockCryAudio } from "@/lib/cry-audio";

export function ChallengeLanding({ card, token, runLabel }: { card: ShareCard; token: string; runLabel: string }) {
  const [playing, setPlaying] = useState(false);
  const t = useT(challengeNs);
  const mt = useT(modesNs);
  const [round, setRound] = useState(0);
  const who = card.n || t("aTrainer");

  if (playing) {
    return (
      <div className="space-y-6">
        <p className="text-center text-sm text-muted-foreground">
          <Swords className="mr-1 inline h-4 w-4" /> {t.rich("from", { who, run: runLabel, b: (c) => <b className="text-foreground">{c}</b> })}
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
      <div className="mx-auto mb-4 max-w-xl">
        <BackButton href="/quiz" label={t("back")} />
      </div>
      <Card className="mx-auto max-w-xl overflow-hidden">
        <div className="bg-gradient-to-br from-primary/20 via-transparent to-transparent p-6 text-center">
          <Swords className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <p className="mt-3 hud-label text-screen">{t("challenged")}</p>
          <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-tight">
            {t("scored", { who, correct: card.c, total: card.t })}
          </h1>
          <p className="text-muted-foreground">
            {t.rich("line", { run: runLabel, iq: card.q, score: num(card.sc, t.locale), b: (c) => <b className="text-foreground">{c}</b> })}
          </p>
        </div>
        <CardContent className="space-y-6 p-6">
          <ResultGrid grid={card.gr} />
          <p className="text-center text-sm text-muted-foreground">
            {t("same", { mode: t.locale === "en" ? mt(`modules.${card.m}.title`).toLowerCase() : mt(`modules.${card.m}.title`) })}
          </p>
          <Button
            size="lg"
            className="w-full text-base"
            onClick={() => {
              if (card.m === "cry") unlockCryAudio(); // question 1's cry can then play by itself
              setPlaying(true);
            }}
          >
            {t("accept")}
          </Button>
          {card.day && (
            <Link href="/daily" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
              <CalendarDays className="h-4 w-4" aria-hidden /> {t("daily")}
            </Link>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
