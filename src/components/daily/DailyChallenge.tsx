"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { Flame, Play, Trophy } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, useProgress } from "@/lib/progress";
import { challengeUrl, quizShareText, shareUrl, type QuizShareResult } from "@/lib/share";
import { useToday } from "@/lib/use-today";
import { ShareButton } from "@/components/share/ShareButton";
import { QuizController } from "@/components/quiz/QuizController";
import { ModeIcon } from "@/components/game/ModeIcon";
import { ResultGrid } from "@/components/quiz/ResultGrid";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DailyEmailNudge } from "@/components/email/DailyEmailNudge";
import { num } from "@/components/quiz/num";
import { useT } from "@/i18n/client";
import dailyNs from "@/messages/quiz-daily";
import shareNs from "@/messages/share";

export function DailyChallenge() {
  const t = useT(dailyNs);
  const st = useT(shareNs);
  const progress = useProgress();
  // The local date is only known after mount (the page is prerendered) and
  // rolls over at midnight; a run in progress keeps the date it started on.
  const today = useToday();
  const [playDate, setPlayDate] = useState<string | null>(null);
  const date = playDate ?? today;
  const number = date ? dailyNumber(date) : null;
  const done = date ? progress?.daily.results[date] : undefined;

  const header = (
    <div className="mx-auto max-w-2xl space-y-2 text-center">
      <p className="hud-label text-screen">{number ? t("labelNumber", { n: number }) : t("label")}</p>
      <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("title")}</h1>
      <p className="text-muted-foreground">{t("intro")}</p>
    </div>
  );

  if (playDate) {
    return (
      <div className="space-y-8">
        {header}
        <QuizController request={{ daily: playDate }} />
      </div>
    );
  }

  if (!progress || !date) {
    return (
      <div className="space-y-8">
        {header}
        <Skeleton className="mx-auto max-w-2xl" aria-hidden>
          <div className="invisible">
            <FreshCard number={null} onStart={() => undefined} />
          </div>
        </Skeleton>
      </div>
    );
  }

  if (done) {
    const streak = currentStreak(progress.daily.last, progress.daily.streak, date);
    /** The day's result; its link is the run's /c/ challenge when there is one, else a /s/ result link. */
    const shareTextNow = () => {
      const result: QuizShareResult = {
        game: "quiz",
        module: "mixed",
        format: "classic",
        daily: number ?? 1,
        correct: done.correct,
        total: done.total,
        pokeiq: done.pokeiq,
        score: done.score,
        grid: done.grid,
        ...(streak > 0 ? { streak } : {}),
      };
      return quizShareText(result, done.shareToken ? challengeUrl(done.shareToken, st.locale) : shareUrl(result, st.locale), st);
    };
    return (
      <div className="space-y-8">
        {header}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6 text-center">
              <div>
                <div className="text-sm text-muted-foreground">{t("youScored")}</div>
                <div className="text-5xl font-black">
                  {done.correct}/{done.total}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {t.rich("iq", { iq: done.pokeiq, score: num(done.score, t.locale), b: (c) => <b className="text-primary">{c}</b> })}
                </div>
              </div>
              <ResultGrid grid={done.grid} />
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-orange-400">
                <Flame className="h-4 w-4" /> {t("streak", { n: streak, best: progress.daily.best })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ShareButton size="lg" kind="daily" getText={shareTextNow} />
                <Link href={`/leaderboard?board=daily&date=${date}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                  <Trophy className="h-4 w-4" /> {t("leaderboard")}
                </Link>
              </div>
              <NextDailyCountdown label={t("next")} />
              <DailyEmailNudge />
              <p className="text-sm text-muted-foreground">
                {t.rich("more", {
                  dle: (c) => <Link href="/pokedle" className="text-primary hover:underline">{c}</Link>,
                  quiz: (c) => <Link href="/quiz" className="text-primary hover:underline">{c}</Link>,
                })}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}
      <FreshCard number={number} onStart={() => setPlayDate(date)} />
    </div>
  );
}

/** Today's challenge, ready to start. While the date and progress load, an invisible copy sizes the placeholder, so nothing below it moves. */
function FreshCard({ number, onStart }: { number: number | null; onStart: () => void }) {
  const t = useT(dailyNs);
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="space-y-6 p-6">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {(
            [
              "whos-that",
              "dex",
              "types",
              "higher-lower",
            ] as const
          ).map((mod) => (
            <li key={mod} className="flex items-center gap-3 rounded-md border bg-shade/20 p-3 font-display font-semibold uppercase tracking-wide">
              <span className="screen icon-well flex h-9 w-9 items-center justify-center rounded-sm text-screen">
                <ModeIcon module={mod} className="relative z-[3] h-4 w-4" />
              </span>
              {t(`parts.${mod}`)}
            </li>
          ))}
        </ul>
        <p className="text-center text-sm text-muted-foreground">{t("rules")}</p>
        <Button size="lg" className="w-full text-base" onClick={onStart}>
          <Play className="h-5 w-5" /> {t("start", { n: number ?? "" })}
        </Button>
      </CardContent>
    </Card>
  );
}
