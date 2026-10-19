"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Radio, Swords } from "lucide-react";
import { CPU_LEVEL_INFO, CPU_LEVELS, PLAY_FORMAT_INFO, PLAY_FORMATS, battleHref, type BattleSeatResponse, type CpuLevel, type PlayFormatId } from "@/lib/battle/play";
import { saveBattleSeat } from "@/lib/battle/seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TeamPick } from "./TeamPick";

/**
 * Starting a battle: against the computer (pick a level) or a friend (an
 * invite link), in a random format or one you bring a team to.
 */

export type Opponent = "cpu" | "pvp";

/** The last battle against the computer, so "Play again" can start the same one. */
const LAST_KEY = "pokeiq:battle:last-cpu";

export interface CpuSetup {
  name: string;
  format: PlayFormatId;
  level: CpuLevel;
  team?: string;
}

export function rememberCpuSetup(setup: CpuSetup) {
  try {
    window.sessionStorage.setItem(LAST_KEY, JSON.stringify(setup));
  } catch {
    // "Play again" then goes back to the setup page
  }
}

export function lastCpuSetup(): CpuSetup | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as CpuSetup) : null;
  } catch {
    return null;
  }
}

/** Starts a battle; returns its page, or throws with the server's reason. */
export async function startBattle(body: { mode: Opponent } & Omit<CpuSetup, "level"> & { level?: CpuLevel }): Promise<string> {
  const res = await fetch("/api/battle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Partial<BattleSeatResponse> & { error?: string };
  if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
  saveBattleSeat(data.code, data.token);
  if (body.mode === "cpu") rememberCpuSetup({ name: body.name, format: body.format, level: body.level ?? "normal", team: body.team });
  return battleHref(body.mode, data.code);
}

export function BattleSetup({ initial = "cpu" }: { initial?: Opponent }) {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [opponent, setOpponent] = useState<Opponent>(initial);
  const [format, setFormat] = useState<PlayFormatId>("gen9randombattle");
  const [level, setLevel] = useState<CpuLevel>("normal");
  const [team, setTeam] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = PLAY_FORMAT_INFO[format];
  const needsTeam = !info.random;

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const onTeam = useCallback((t: string) => setTeam(t), []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const href = await startBattle({ mode: opponent, name: name.trim(), format, level: opponent === "cpu" ? level : undefined, team: needsTeam ? team : undefined });
      if (!progress?.name) setTrainerName(name.trim());
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a battle.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={start} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Opponent */}
        <fieldset className="space-y-2">
          <legend className="hud-label mb-2">Opponent</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["cpu", Bot, "Computer", "Battle a computer opponent, right now."],
                ["pvp", Radio, "A friend", "Get an invite link and battle live, with a turn timer."],
              ] as const
            ).map(([value, Icon, title, blurb]) => (
              <label
                key={value}
                className={cn("menu-item hud flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4", opponent === value && "border-primary ring-1 ring-primary")}
                data-selected={opponent === value}
              >
                <input type="radio" name={`${id}-opponent`} value={value} checked={opponent === value} onChange={() => setOpponent(value)} className="sr-only" />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block font-display font-bold uppercase">{title}</span>
                  <span className="block text-sm text-muted-foreground">{blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Format */}
        <fieldset className="space-y-2">
          <legend className="hud-label mb-2">Format</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLAY_FORMATS.map((f) => (
              <label
                key={f}
                className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", format === f && "border-primary ring-1 ring-primary")}
              >
                <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold uppercase">{PLAY_FORMAT_INFO[f].name}</span>
                  <span className="hud-label text-screen">{PLAY_FORMAT_INFO[f].random ? "Random" : "Your team"}</span>
                </span>
                <span className="text-xs text-muted-foreground">{PLAY_FORMAT_INFO[f].gameType === "doubles" ? "Doubles. " : ""}{PLAY_FORMAT_INFO[f].random ? PLAY_FORMAT_INFO[f].blurb : "Bring a saved or pasted team."}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {opponent === "cpu" && (
          <fieldset className="space-y-2">
            <legend className="hud-label mb-2">Computer level</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CPU_LEVELS.map((l) => (
                <label key={l} className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", level === l && "border-primary ring-1 ring-primary")}>
                  <input type="radio" name={`${id}-level`} value={l} checked={level === l} onChange={() => setLevel(l)} className="sr-only" />
                  <span className="font-display text-sm font-bold uppercase">{CPU_LEVEL_INFO[l].name}</span>
                  <span className="text-xs text-muted-foreground">{CPU_LEVEL_INFO[l].blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {needsTeam && (
          <Card>
            <CardContent className="p-4">
              <TeamPick key={format} format={format} onChange={onTeam} idPrefix={id} />
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit border-primary/40 lg:sticky lg:top-20">
        <CardContent className="space-y-4 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> {opponent === "cpu" ? "Battle the computer" : "Battle a friend"}
          </p>
          <p className="font-display text-2xl font-bold uppercase leading-tight">{info.name}</p>
          <p className="text-sm text-muted-foreground">
            {opponent === "cpu"
              ? `${CPU_LEVEL_INFO[level].name} computer. ${info.random ? "Random teams for both of you." : "It brings its own team."}`
              : "You'll get a link to send. The battle starts when you're both ready."}
          </p>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="hud-label">
              Your trainer name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              placeholder="Trainer name"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !name.trim() || (needsTeam && !team)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
            {opponent === "cpu" ? "Start battle" : "Create battle"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
