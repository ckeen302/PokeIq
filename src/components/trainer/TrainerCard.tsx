"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import { BADGES, currentStreak, levelInfo, setTrainerName, useProgress } from "@/lib/progress";
import { localDateString } from "@/lib/daily";
import { iqTitle, ratingToIQ } from "@/lib/rating";
import { MODULE_INFO, PLAY_MODULES, PLAYABLE_FORMATS as FORMATS } from "@/lib/modes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CoachPanel } from "./CoachPanel";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { ModeIcon } from "@/components/game/ModeIcon";
import { cn } from "@/lib/utils";

/** Local-first trainer profile: level, PokéIQ, streaks, bests and badges. */
export function TrainerCard() {
  const progress = useProgress();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (progress) setName(progress.name);
  }, [progress]);

  if (!progress) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  // Safe here: progress (and so this branch) only exists after mount.
  const today = localDateString();
  const lvl = levelInfo(progress.xp);
  const iq = progress.rating !== null ? ratingToIQ(progress.rating) : null;
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const dailyDays = Object.keys(progress.daily.results).length;
  const dleSolved = Object.values(progress.dle.results).filter((r) => r.solved).length;

  function saveName() {
    setTrainerName(name);
    setEditing(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-primary/25 via-primary/5 to-transparent p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="hud-label text-screen">Trainer card</p>
                {editing ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveName();
                    }}
                  >
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      className="h-10 rounded-md border border-input bg-background px-3 text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Your trainer name"
                    />
                    <button type="submit" className="rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
                      Save
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-2 text-left">
                    <h1 className="font-display text-3xl font-bold uppercase tracking-wide">{progress.name || "Unnamed Trainer"}</h1>
                    <Pencil className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-label="Edit name" />
                  </button>
                )}
                <p className="text-sm text-muted-foreground">
                  Level {lvl.level} · {progress.xp.toLocaleString()} XP · {lvl.toNext} XP to level {lvl.level + 1}
                </p>
              </div>
              <div className="text-right">
                <div className="hud-label">PokéIQ</div>
                <div className="font-display text-5xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.5)]">{iq ?? "--"}</div>
                <div className="text-xs text-muted-foreground">{iq !== null ? iqTitle(iq) : "Play a run to get rated"}</div>
              </div>
            </div>
            <div className="mt-4 meter">
              <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${lvl.progress * 100}%` }} transition={{ duration: 0.8 }} />
            </div>
          </div>
          <CardContent className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-4">
            <Stat label="Runs" value={progress.runs} />
            <Stat label="Accuracy" value={`${accuracy}%`} />
            <Stat label="Best streak" value={progress.bestStreak} />
            <Stat label="Daily streak" value={currentStreak(progress.daily.last, progress.daily.streak, today)} />
            <Stat label="Dailies played" value={dailyDays} />
            <Stat label="Best daily streak" value={progress.daily.best} />
            <Stat label="Pokédles solved" value={dleSolved} />
            <Stat label="Pokédle streak" value={currentStreak(progress.dle.last, progress.dle.streak, today)} />
          </CardContent>
        </Card>
      </motion.div>

      <CoachPanel progress={progress} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Badges <span className="text-sm font-normal text-muted-foreground">({Object.keys(progress.badges).length}/{BADGES.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BADGES.map((b) => {
            const unlocked = Boolean(progress.badges[b.id]);
            return (
              <div
                key={b.id}
                className={cn("flex items-center gap-3 rounded-md border p-3", unlocked ? "border-warning/40 bg-warning/[0.06]" : "border-foreground/[0.06] opacity-60")}
                title={b.description}
              >
                <BadgeMedal id={b.id} unlocked={unlocked} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{b.name}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">{b.description}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Personal bests</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Mode</th>
                {FORMATS.map((f) => (
                  <th key={f} className="p-3 text-right capitalize">{f}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAY_MODULES.map((m) => (
                <tr key={m} className="border-b last:border-0">
                  <td className="p-3">
                    <ModeIcon module={m} className="mr-2 inline h-4 w-4 text-muted-foreground" />
                    {MODULE_INFO[m].title}
                  </td>
                  {FORMATS.map((f) => (
                    <td key={f} className="p-3 text-right font-mono tabular-nums">
                      {progress.best[`${m}:${f}`]?.toLocaleString() ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Progress is saved in this browser. <Link href="/play" className="text-primary hover:underline">Play more modes →</Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-muted/40 p-3 text-center">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
