"use client";

import Link from "next/link";
import { ratingToIQ, iqTitle } from "@/lib/rating";
import { levelInfo, useProgress } from "@/lib/progress";

/** Returning players see their numbers; new players get a call to action. */
export function HeroStats() {
  const progress = useProgress();
  if (!progress || progress.runs === 0) {
    return (
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/daily" className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90">
          Play the Daily Challenge
        </Link>
        <Link href="/iq-test" className="rounded-full border px-6 py-3 font-semibold transition hover:bg-accent">
          Take the PokéIQ Test
        </Link>
      </div>
    );
  }
  const iq = progress.rating !== null ? ratingToIQ(progress.rating) : null;
  return (
    <Link href="/trainer" className="mx-auto flex w-fit flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border bg-card/70 px-6 py-3 text-sm transition hover:border-primary/40">
      {iq !== null && (
        <span>
          <span className="font-bold text-primary">PokéIQ {iq}</span> <span className="text-muted-foreground">· {iqTitle(iq)}</span>
        </span>
      )}
      <span className="text-muted-foreground">Level <b className="text-foreground">{levelInfo(progress.xp).level}</b></span>
      <span className="text-muted-foreground">🔥 Daily streak <b className="text-foreground">{progress.daily.streak}</b></span>
      <span className="text-muted-foreground">Accuracy <b className="text-foreground">{progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0}%</b></span>
    </Link>
  );
}
