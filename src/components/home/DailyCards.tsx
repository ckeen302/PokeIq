"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, CheckCircle2, Flame, Search } from "lucide-react";
import { dailyNumber, localDateString } from "@/lib/daily";
import { useProgress } from "@/lib/progress";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";

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
        icon={<CalendarDays className="h-6 w-6" />}
        title="Daily Challenge"
        number={today ? dailyNumber(today) : null}
        description="10 mixed questions. Same quiz for everyone today — compare your PokéIQ."
        status={daily ? `Done · ${daily.correct}/${daily.total} · IQ ${daily.pokeiq}` : null}
        streak={progress?.daily.streak ?? 0}
        accent="43 96% 56%"
      />
      <DailyCard
        href="/pokedle"
        icon={<Search className="h-6 w-6" />}
        title="Pokédle"
        number={today ? dailyNumber(today) : null}
        description="Guess the mystery Pokémon in 8 tries using type, generation, size and color clues."
        status={dle?.over ? (dle.solved ? `Solved in ${dle.guesses.length}` : "Missed today") : dle?.guesses.length ? `In progress · ${dle.guesses.length}/8` : null}
        streak={progress?.dle.streak ?? 0}
        accent="199 89% 55%"
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
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
      <Link href={href} className="group block h-full">
        <div
          className="glow-card relative h-full overflow-hidden rounded-2xl border p-6"
          style={{
            "--glow": accent,
            background: `linear-gradient(135deg, hsl(${accent} / 0.16), hsl(var(--card)) 60%)`,
          } as React.CSSProperties}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `hsl(${accent} / 0.2)`, color: `hsl(${accent})` }}>
                {icon}
              </span>
              <div>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="text-xs text-muted-foreground">{number ? `#${number}` : " "}</p>
              </div>
            </div>
            {streak > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-xs font-bold text-orange-400">
                <Flame className="h-3.5 w-3.5" /> {streak}
              </span>
            )}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{description}</p>
          <div className="mt-5 flex items-center justify-between">
            {status ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> {status}
              </span>
            ) : (
              <span className="rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground" style={{ background: `hsl(${accent})` }}>
                Play today&apos;s
              </span>
            )}
          </div>
          {status && <div className="mt-3"><NextDailyCountdown /></div>}
        </div>
      </Link>
    </motion.div>
  );
}
