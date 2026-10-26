"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2, Users } from "lucide-react";
import { NEA_PATH, neaDailyCategory, standardMinutes } from "@/lib/name-em-all/categories";
import { loadBests } from "@/lib/name-em-all/local";
import { neaClock } from "@/lib/name-em-all/share";
import { RACE_MAX, RACE_MINUTES, raceHref, type NeaRaceSeatResponse } from "@/lib/name-em-all/race";
import { useToday } from "@/lib/use-today";
import { saveSeat } from "@/lib/duel-seat";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";

/** Today's shared category, and how this device did on it. */
export function NeaDailyCard({ labels, counts }: { labels: Record<string, string>; counts: Record<string, number> }) {
  const today = useToday();
  const [best, setBest] = useState<{ named: number; total: number; ms: number } | null>(null);
  const cat = today ? neaDailyCategory(today) : null;
  useEffect(() => {
    if (today) setBest(loadBests()[`daily:${today}`] ?? null);
  }, [today]);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-5" data-testid="nea-daily-card">
      <p className="hud-label flex items-center gap-1.5 text-screen">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Daily
      </p>
      <h2 className="font-display text-2xl font-bold uppercase leading-tight">
        Today: <span className="text-primary">{cat ? labels[cat] : "…"}</span>
      </h2>
      <p className="min-h-10 text-sm text-muted-foreground">
        {cat ? `${counts[cat]} Pokémon in ${standardMinutes(counts[cat])} minutes. The same category for everyone, with its own board.` : "Loading today's category…"}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-3">
        <Link href={`${NEA_PATH}/daily`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] hover:brightness-110" data-testid="nea-daily-play">
          {best ? "See today's board" : "Play today's"}
        </Link>
        {best && (
          <span className="hud-label">
            You: {best.named}/{best.total} in {neaClock(best.ms)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Opens a race lobby: pick the category and length, share the link. */
export function NeaRaceCard({ options }: { options: { id: string; label: string; total: number }[] }) {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("gen-1");
  const [minutes, setMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function start() {
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/name-em-all/race", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), category, minutes }) });
      const data = (await res.json().catch(() => ({}))) as Partial<NeaRaceSeatResponse> & { error?: string };
      if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? "Couldn't open a race.");
      saveSeat(data.code, data.token);
      if (!progress?.name) setTrainerName(name.trim());
      router.push(raceHref(data.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open a race.");
      setBusy(false);
    }
  }

  const field = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
      data-testid="nea-race-card"
    >
      <p className="hud-label flex items-center gap-1.5 text-screen">
        <Users className="h-3.5 w-3.5" aria-hidden /> Race
      </p>
      <h2 className="font-display text-2xl font-bold uppercase leading-tight">Race up to {RACE_MAX} friends</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="hud-label">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={field} aria-label="Race category">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({o.total})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="hud-label">Length</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field} aria-label="Race length">
            {RACE_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          Your trainer name
        </label>
        <input id={id} value={name} maxLength={24} onChange={(e) => (setName(e.target.value), setError(null))} placeholder="Your trainer name" aria-label="Your trainer name" className={field} />
        <Button type="submit" disabled={busy || !name.trim()} className="shrink-0" data-testid="nea-race-start">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />} Start a race
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
