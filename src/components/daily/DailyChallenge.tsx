"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Flame, Play, Share2, Trophy } from "lucide-react";
import { dailyNumber, localDateString } from "@/lib/daily";
import { useProgress } from "@/lib/progress";
import { emojiGrid, shareOrCopy } from "@/lib/share";
import { QuizController } from "@/components/quiz/QuizController";
import { ResultGrid } from "@/components/quiz/ResultGrid";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DailyChallenge() {
  const progress = useProgress();
  const [date] = useState(() => localDateString());
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const number = dailyNumber(date);
  const done = progress?.daily.results[date];

  const header = (
    <div className="mx-auto max-w-2xl space-y-2 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Daily Challenge #{number}</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Today&apos;s PokéIQ test</h1>
      <p className="text-muted-foreground">10 mixed questions, the same for every trainer. One attempt — make it count.</p>
    </div>
  );

  if (playing) {
    return (
      <div className="space-y-8">
        {header}
        <QuizController request={{ daily: date }} />
      </div>
    );
  }

  if (!progress) {
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
      const outcome = await shareOrCopy(text, done!.shareToken ? `${window.location.origin}/c/${done!.shareToken}` : window.location.href);
      if (outcome !== "failed") {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
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
                <Flame className="h-4 w-4" /> {progress.daily.streak}-day streak · best {progress.daily.best}
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
            {[
              ["👤", "Silhouettes"],
              ["📖", "Pokédex entries"],
              ["⚔️", "Type matchups"],
              ["📊", "Stat battles"],
            ].map(([emoji, label]) => (
              <li key={label} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <span className="text-xl" aria-hidden>{emoji}</span> {label}
              </li>
            ))}
          </ul>
          <p className="text-center text-sm text-muted-foreground">15 seconds per question · speed and streak bonuses</p>
          <Button size="lg" className="w-full text-base" onClick={() => setPlaying(true)}>
            <Play className="h-5 w-5" /> Start Daily #{number}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
