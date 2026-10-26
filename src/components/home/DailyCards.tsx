"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Compass, Flame, Grid3x3, LayoutGrid, Search } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, geoDailyStreak, useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { dleStats } from "@/lib/dle-stats";
import { connStats } from "@/lib/connections/local";
import { connNumber } from "@/lib/connections/types";
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
  const conn = today ? progress?.conn?.results[today] : undefined;
  const pdk = today ? progress?.pdk?.results[today] : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6 2xl:grid-cols-5">
      <DailyCard
        className="lg:col-span-2 2xl:col-span-1"
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
        className="lg:col-span-2 2xl:col-span-1"
        href="/pokedle"
        icon={<Search className="h-5 w-5" />}
        title="Pokédle"
        number={today ? dailyNumber(today) : null}
        description="Deduce the mystery Pokémon in 8 guesses from type, generation, size and color."
        status={dle?.over ? (dle.solved ? `Solved in ${dle.guesses.length}` : "Missed today") : dle?.guesses.length ? `In progress · ${dle.guesses.length}/8` : null}
        cleared={!!dle?.over}
        streak={progress && today ? dleStats(progress.dle.results, today).playStreak : 0}
        accent="258 94% 74%"
      />
      <DailyCard
        className="lg:col-span-2 2xl:col-span-1"
        href="/guessr"
        icon={<Compass className="h-5 w-5" />}
        title="PokéGuessr"
        number={today ? dailyNumber(today) : null}
        description="GeoGuessr for Pokémon: 5 places a day. Look around, drop a pin on the map."
        status={geo !== undefined ? `Cleared · ${geo.toLocaleString("en-US")} / 25,000` : null}
        cleared={geo !== undefined}
        streak={progress && today ? geoDailyStreak(progress, today) : 0}
        accent="154 68% 46%"
      />
      <DailyCard
        className="lg:col-span-3 2xl:col-span-1"
        href="/connections"
        icon={<LayoutGrid className="h-5 w-5" />}
        title="PokéConnections"
        number={today ? connNumber(today) : null}
        description="16 Pokémon, 4 hidden groups. Find the links with 4 mistakes to spare."
        status={conn?.over ? (conn.solved ? (conn.mistakes ? `Solved · ${conn.mistakes} mistake${conn.mistakes === 1 ? "" : "s"}` : "Perfect") : "Missed today") : conn?.guesses.length ? "In progress" : null}
        cleared={!!conn?.over}
        streak={progress?.conn && today ? connStats(progress.conn.results, today).playStreak : 0}
        accent="42 98% 60%"
      />
      <DailyCard
        className="md:col-span-2 lg:col-span-3 2xl:col-span-1"
        href="/pikadoku"
        icon={<Grid3x3 className="h-5 w-5" />}
        title="Pikadoku"
        number={today ? connNumber(today) : null}
        description="Pokémon Sudoku: fill a 3×3 grid, one Pokémon per cell. Be rare to score low."
        status={pdk?.over ? `${pdk.solved}/9${pdk.score !== null ? ` · score ${pdk.score}` : ""}` : pdk?.guesses.length ? "In progress" : null}
        cleared={!!pdk?.over}
        streak={progress?.pdk && today ? currentStreak(progress.pdk.last, progress.pdk.streak, today) : 0}
        accent="190 90% 55%"
      />
    </div>
  );
}

interface DailyCardProps {
  className?: string;
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

function DailyCard({ className, href, icon, title, number, description, status, cleared, streak, accent }: DailyCardProps) {
  return (
    <motion.div className={cn("h-full", className)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Link href={href} className="group block h-full">
        <div className="hud relative flex h-full flex-col overflow-hidden rounded-lg border bg-card p-5 transition-colors group-hover:border-screen/50">
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `hsl(${accent})`, boxShadow: `0 0 14px hsl(${accent})` }} aria-hidden />
          <div className="flex items-center justify-between gap-2">
            <span className="screen flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ color: `hsl(${accent})` }}>
              <span className="relative z-[3]">{icon}</span>
            </span>
            <div className="flex flex-col items-end gap-1">
              <span className={cn("hud-label flex items-center gap-1.5 whitespace-nowrap", cleared ? "text-success" : status ? "text-warning" : "text-primary")}>
                <span className={cn("led h-1.5 w-1.5", cleared ? "text-success" : status ? "text-warning" : "animate-blink text-primary")} />
                {cleared ? "Cleared" : status ? "In progress" : "New"}
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-1 whitespace-nowrap font-pixel text-[10px] text-warning">
                  <Flame className="h-3 w-3" /> {streak} day{streak === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <h3 className="mt-4 font-display text-lg font-bold uppercase leading-tight tracking-wide 2xl:text-base 2xl:tracking-normal">{title}</h3>
          <p className="hud-label mt-1">{number ? `No.${String(number).padStart(3, "0")}` : "\u00a0"}</p>
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          <div className="mt-auto pt-5">
            <div className="flex items-center justify-between gap-2">
              {status ? (
                <span className={cn("text-sm font-medium", cleared ? "text-success" : "text-warning")}>{status}</span>
              ) : (
                <span className="flex items-center gap-1 whitespace-nowrap font-display text-sm font-bold uppercase tracking-wider" style={{ color: `hsl(${accent})` }}>
                  ▶ Play today&apos;s
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
            {cleared && (
              <div className="mt-3 whitespace-nowrap border-t border-foreground/[0.06] pt-3 [&_*]:text-xs">
                <NextDailyCountdown />
              </div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
