"use client";

import Link from "next/link";
import { ratingToIQ, iqTitle } from "@/lib/rating";
import { currentStreak, levelInfo, useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";

/** A trainer readout on the title screen, for players who've been here before. */
export function HeroStats() {
  const progress = useProgress();
  const today = useToday();
  if (!progress || progress.runs === 0) return null;
  const iq = progress.rating != null ? ratingToIQ(progress.rating) : null;

  return (
    <Link
      href="/trainer"
      className="grid w-fit grid-cols-3 divide-x divide-foreground/10 rounded-md border bg-card/80 text-center backdrop-blur transition-colors duration-300 animate-in fade-in hover:border-screen/50 motion-reduce:animate-none"
    >
      <Readout label="PokéIQ" value={iq !== null ? String(iq) : "—"} sub={iq !== null ? iqTitle(iq) : "Unrated"} />
      <Readout label="Level" value={String(levelInfo(progress.xp).level)} sub={`${progress.xp} XP`} />
      <Readout label="Streak" value={String(today ? currentStreak(progress.daily.last, progress.daily.streak, today) : 0)} sub="days" />
    </Link>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-4 py-2 sm:px-5">
      <div className="hud-label">{label}</div>
      <div className="font-display text-xl font-bold tabular-nums text-screen sm:text-2xl">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
