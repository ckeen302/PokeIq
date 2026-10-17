"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { ratingToIQ, iqTitle } from "@/lib/rating";
import { levelInfo, useProgress } from "@/lib/progress";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Title-screen actions, plus a trainer readout for returning players. */
export function HeroStats() {
  const progress = useProgress();
  const returning = progress && progress.runs > 0;
  const iq = progress?.rating != null ? ratingToIQ(progress.rating) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Link href="/daily" className={cn(buttonVariants({ size: "lg" }))}>
          <Play className="h-4 w-4 fill-current" /> Daily Challenge
        </Link>
        <Link href="/iq-test" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
          Take the PokéIQ Test
        </Link>
      </div>
      {returning && (
        <Link href="/trainer" className="grid w-fit grid-cols-3 divide-x divide-white/10 rounded-md border bg-card/80 text-center transition-colors hover:border-screen/50">
          <Readout label="PokéIQ" value={iq !== null ? String(iq) : "—"} sub={iq !== null ? iqTitle(iq) : "Unrated"} />
          <Readout label="Level" value={String(levelInfo(progress.xp).level)} sub={`${progress.xp} XP`} />
          <Readout label="Streak" value={String(progress.daily.streak)} sub="days" />
        </Link>
      )}
    </div>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-5 py-2.5">
      <div className="hud-label">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums text-screen">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
