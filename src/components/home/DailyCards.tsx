"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Compass, Flame, Search } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { cn } from "@/lib/utils";

/** The daily hooks, with today's status pulled from local progress. */
export function DailyCards() {
  const progress = useProgress();
  const date = useToday();
  const today = progress ? date : null;
  const daily = today ? progress?.daily.results[today] : undefined;
  const dle = today ? progress?.dle.results[today] : undefined;
  const geo = today ? progress?.best[`geo-daily:${today}`] : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <DailyCard
        href="/daily"
        icon={<CalendarDays className="h-5 w-5" />}
        title="Daily Challenge"
        number={today ? dailyNumber(today) : null}
        description="10 mixed questions. Same quiz for every trainer today."
        status={daily ? `Cleared · ${daily.correct}/${daily.total} · IQ ${daily.pokeiq}` : null}
        cleared={!!daily}
        streak={progress && today ? currentStreak(progress.daily.last, progress.daily.streak, today) : 0}
        accent="340 86% 60%"
      />
      <DailyCard
        href="/pokedle"
        icon={<Search className="h-5 w-5" />}
        title="Pokédle"
        number={today ? dailyNumber(today) : null}
        description="Deduce the mystery Pokémon in 8 guesses from type, generation, size and color."
        status={dle?.over ? (dle.solved ? `Solved in ${dle.guesses.length}` : "Missed today") : dle?.guesses.length ? `In progress · ${dle.guesses.length}/8` : null}
        cleared={!!dle?.over}
        streak={progress && today ? currentStreak(progress.dle.last, progress.dle.streak, today) : 0}
        accent="258 94% 74%"
      />
      <DailyCard
        href="/guessr"
        icon={<Compass className="h-5 w-5" />}
        title="PokéGuessr"
        number={today ? dailyNumber(today) : null}
        description="GeoGuessr for Pokémon: 5 places in Kanto. Look around, drop a pin on the map."
        status={geo !== undefined ? `Cleared · ${geo.toLocaleString("en-US")} / 25,000` : null}
        cleared={geo !== undefined}
        streak={0}
        accent="154 68% 46%"
      />
    </div>
  );
}

interface DailyCardProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  number: number | null;
  description: string;
  status: string | null;
  /** Today's puzzle is finished (an in-progress status is not "cleared"). */
  cleared: boolean;
  streak: number;
  accent: string;
}

function DailyCard({ href, icon, title, number, description, status, cleared, streak, accent }: DailyCardProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Link href={href} className="group block h-full">
        <div className="hud relative h-full overflow-hidden rounded-lg border bg-card p-5 transition-colors group-hover:border-screen/50">
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `hsl(${accent})`, boxShadow: `0 0 14px hsl(${accent})` }} aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="screen flex h-11 w-11 items-center justify-center rounded-md" style={{ color: `hsl(${accent})` }}>
                <span className="relative z-[3]">{icon}</span>
              </span>
              <div>
                <h3 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h3>
                <p className="hud-label">{number ? `No.${String(number).padStart(3, "0")}` : " "}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={cn("hud-label flex items-center gap-1.5", cleared ? "text-success" : status ? "text-warning" : "text-primary")}>
                <span className={cn("led h-1.5 w-1.5", cleared ? "text-success" : status ? "text-warning" : "animate-blink text-primary")} />
                {cleared ? "Cleared" : status ? "In progress" : "New"}
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-1 font-pixel text-[10px] text-warning">
                  <Flame className="h-3 w-3" /> {streak} day{streak === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{description}</p>
          <div className="mt-5 flex items-center justify-between">
            {status ? (
              <span className={cn("text-sm font-medium", cleared ? "text-success" : "text-warning")}>{status}</span>
            ) : (
              <span className="flex items-center gap-1 font-display text-sm font-bold uppercase tracking-wider" style={{ color: `hsl(${accent})` }}>
                ▶ Play today&apos;s
              </span>
            )}
            <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          {cleared && (
            <div className="mt-3 border-t border-foreground/[0.06] pt-3">
              <NextDailyCountdown />
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
