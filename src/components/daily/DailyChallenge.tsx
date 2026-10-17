"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Flame, Play, Share2, Trophy } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, useProgress } from "@/lib/progress";
import { emojiGrid, shareOrCopy, shareText } from "@/lib/share";
import { useToday } from "@/lib/use-today";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { QuizController } from "@/components/quiz/QuizController";
import { ModeIcon } from "@/components/game/ModeIcon";
import { ResultGrid } from "@/components/quiz/ResultGrid";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DailyChallenge() {
  const progress = useProgress();
  // The local date is only known after mount (the page is prerendered) and
  // rolls over at midnight; a run in progress keeps the date it started on.
  const today = useToday();
  const [playDate, setPlayDate] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const date = playDate ?? today;
  const number = date ? dailyNumber(date) : null;
  const done = date ? progress?.daily.results[date] : undefined;

  const header = (
    <div className="mx-auto max-w-2xl space-y-2 text-center">
      <p className="hud-label text-screen">Daily Challenge{number ? ` #${number}` : ""}</p>
      <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Today&apos;s PokéIQ test</h1>
      <p className="text-muted-foreground">10 mixed questions, the same for every trainer. One attempt — make it count.</p>
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
        <Skeleton className="mx-auto h-64 max-w-2xl" />
      </div>
    );
  }

  if (done) {
    async function share() {
      const text = [`PokéIQ Daily #${number} — ${done!.correct}/${done!.total}`, `🧠 PokéIQ ${done!.pokeiq}`, emojiGrid(done!.grid)].join("\n");
      const url = done!.shareToken ? `${window.location.origin}/c/${done!.shareToken}` : window.location.href;
      const outcome = await shareOrCopy(text, url);
      if (outcome === "failed") {
        setCopyFallback(shareText(text, url));
      } else if (outcome !== "cancelled") {
        setCopyFallback(null);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
    const streak = currentStreak(progress.daily.last, progress.daily.streak, date);
    return (
      <div className="space-y-8">
        {header}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6 text-center">
              <div>
                <div className="text-sm text-muted-foreground">You scored</div>
                <div className="text-5xl font-black">
                  {done.correct}/{done.total}
                </div>
                <div className="mt-1 text-muted-foreground">
                  PokéIQ <b className="text-primary">{done.pokeiq}</b> · {done.score.toLocaleString()} pts
                </div>
              </div>
              <ResultGrid grid={done.grid} />
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-orange-400">
                <Flame className="h-4 w-4" /> {streak}-day streak · best {progress.daily.best}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" onClick={share}>
                  {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                  {copied ? "Copied!" : "Share result"}
                </Button>
                <Link href={`/leaderboard?board=daily&date=${date}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                  <Trophy className="h-4 w-4" /> Today&apos;s leaderboard
                </Link>
              </div>
              {copyFallback && <CopyFallback text={copyFallback} />}
              <NextDailyCountdown label="Next Daily Challenge in" />
              <p className="text-sm text-muted-foreground">
                Still hungry? Try the{" "}
                <Link href="/pokedle" className="text-primary hover:underline">Pokédle</Link> or a{" "}
                <Link href="/play" className="text-primary hover:underline">Survival run</Link>.
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
      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-6 p-6">
          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ["whos-that", "Silhouettes"],
                ["dex", "Pokédex entries"],
                ["types", "Type matchups"],
                ["higher-lower", "Stat battles"],
              ] as const
            ).map(([mod, label]) => (
              <li key={label} className="flex items-center gap-3 rounded-md border bg-shade/20 p-3 font-display font-semibold uppercase tracking-wide">
                <span className="screen flex h-9 w-9 items-center justify-center rounded-sm text-screen">
                  <ModeIcon module={mod} className="relative z-[3] h-4 w-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <p className="text-center text-sm text-muted-foreground">15 seconds per question · speed and streak bonuses</p>
          <Button size="lg" className="w-full text-base" onClick={() => setPlayDate(date)}>
            <Play className="h-5 w-5" /> Start Daily #{number}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
