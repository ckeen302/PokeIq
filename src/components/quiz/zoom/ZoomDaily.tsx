"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, Play } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { ZOOM_STEPS, zoomShareLine } from "@/lib/zoom-reveal";
import { QuizController } from "@/components/quiz/QuizController";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { ShareButton } from "@/components/share/ShareButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The daily Zoom Reveal: one Pokémon a day, the same close-up for every
 * trainer (seeded by the date on the server), no clock. One go per day in
 * this browser; the result and its share line stay for the rest of the day.
 */

const KEY = "piq:zoom-daily";

interface DayResult {
  step: number;
  solved: boolean;
}

function readResults(): Record<string, DayResult> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, DayResult>;
  } catch {
    return {};
  }
}

function saveResult(date: string, result: DayResult) {
  try {
    // Keep the last couple of weeks.
    const kept = Object.entries(readResults())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 13);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([[date, result], ...kept])));
  } catch {
    // Private mode: the result still shows until the page closes.
  }
}

export function ZoomDaily() {
  const today = useToday();
  const [playDate, setPlayDate] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DayResult> | null>(null);
  useEffect(() => setResults(readResults()), []);

  const date = playDate ?? today;
  const number = date ? dailyNumber(date) : null;
  const done = date && results ? results[date] : undefined;
  const title = `Daily Zoom Reveal${number ? ` #${number}` : ""}`;

  if (playDate && !done) {
    return (
      <div className="space-y-3" data-testid="zoom-daily">
        <p className="hud-label text-center text-screen">{title}</p>
        <QuizController
          request={{ zoomDaily: playDate }}
          onComplete={(result) => {
            const step = result.zoom && result.zoom !== "X" ? Number(result.zoom) : ZOOM_STEPS;
            const entry = { step, solved: result.correct > 0 };
            saveResult(playDate, entry);
            setResults((r) => ({ ...r, [playDate]: entry }));
            // Back to the day's card, which now holds the result.
            window.requestAnimationFrame(() => document.querySelector('[data-testid="zoom-daily"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
          }}
        />
      </div>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl overflow-hidden" data-testid="zoom-daily">
      <CardContent className="flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:text-left">
        <span className="screen flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-screen">
          <CalendarDays className="relative z-[3] h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-display text-lg font-bold uppercase tracking-wide">{title}</p>
          {!results || !date ? (
            <Skeleton className="mx-auto h-4 w-48 sm:mx-0" />
          ) : done ? (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-xl tracking-wide" data-testid="zoom-daily-line">
              {zoomShareLine(done.step, done.solved)}
            </motion.p>
          ) : (
            <p className="text-sm text-muted-foreground">One Pokémon, the same close-up for everyone. No clock.</p>
          )}
          {done && <NextDailyCountdown label="Next one in" />}
        </div>
        {done && date ? (
          <ShareButton
            kind="zoom-daily"
            className="w-full sm:w-auto"
            getText={() => [`PokéIQ ${title}`, zoomShareLine(done.step, done.solved), `${window.location.origin}/quiz/pokemon-zoom-quiz`].join("\n")}
          />
        ) : (
          <Button className="w-full sm:w-auto" disabled={!date || !results} onClick={() => date && setPlayDate(date)} data-testid="zoom-daily-start">
            <Play className="h-4 w-4 fill-current" aria-hidden /> Play today&apos;s
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
