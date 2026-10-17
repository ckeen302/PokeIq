"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Flame, Search } from "lucide-react";
import { dailyNumber, localDateString } from "@/lib/daily";
import { useProgress } from "@/lib/progress";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { cn } from "@/lib/utils";

/** The two daily hooks, with today's status pulled from local progress. */
export function DailyCards() {
  const progress = useProgress();
  const today = progress ? localDateString() : null;
  const daily = today ? progress?.daily.results[today] : undefined;
  const dle = today ? progress?.dle.results[today] : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DailyCard
        href="/daily"
        icon={<CalendarDays className="h-5 w-5" />}
        title="Daily Challenge"
        number={today ? dailyNumber(today) : null}
        description="10 mixed questions. Same quiz for every trainer today."
        status={daily ? `Cleared · ${daily.correct}/${daily.total} · IQ ${daily.pokeiq}` : null}
        streak={progress?.daily.streak ?? 0}
        accent="6 84% 53%"
      />
      <DailyCard
        href="/pokedle"
        icon={<Search className="h-5 w-5" />}
        title="Pokédle"
        number={today ? dailyNumber(today) : null}
        description="Deduce the mystery Pokémon in 8 guesses from type, generation, size and color."
        status={dle?.over ? (dle.solved ? `Solved in ${dle.guesses.length}` : "Missed today") : dle?.guesses.length ? `In progress · ${dle.guesses.length}/8` : null}
        streak={progress?.dle.streak ?? 0}
        accent="186 88% 56%"
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
  streak: number;
  accent: string;
}

function DailyCard({ href, icon, title, number, description, status, streak, accent }: DailyCardProps) {
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
              <span className={cn("hud-label flex items-center gap-1.5", status ? "text-success" : "text-primary")}>
                <span className={cn("led h-1.5 w-1.5", status ? "text-success" : "animate-blink text-primary")} />
                {status ? "Cleared" : "New"}
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
              <span className="text-sm font-medium text-success">{status}</span>
            ) : (
              <span className="flex items-center gap-1 font-display text-sm font-bold uppercase tracking-wider" style={{ color: `hsl(${accent})` }}>
                ▶ Play today&apos;s
              </span>
            )}
            <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          {status && (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <NextDailyCountdown />
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
