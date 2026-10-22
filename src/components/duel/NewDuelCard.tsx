"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords, UserSearch, X } from "lucide-react";
import { saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clock } from "./DuelParts";
import { useMatchmaking } from "./use-matchmaking";
import { HowItWorks } from "./HowItWorks";

/** Device time, ticking twice a second while `on`. */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/**
 * "Duel a friend": opens a duel and goes to its lobby, where the share link
 * is. `body` is what the endpoint needs besides the trainer's name (the game,
 * a map, a quiz's mode and difficulty), and `children` the controls that pick
 * it. With `match` (the game and settings to search for), "Find an
 * opponent" pairs the trainer with someone searching for the same, no link
 * needed.
 */
export function NewDuelCard({
  endpoint = "/api/duel",
  body,
  href,
  heading,
  blurb,
  match,
  info,
  children,
}: {
  endpoint?: string;
  body: Record<string, unknown>;
  /** The new duel's page. */
  href: (code: string) => string;
  heading: string;
  blurb: React.ReactNode;
  /** Matchmaking settings, e.g. { game: "geo", region }. */
  match?: Record<string, unknown>;
  children?: React.ReactNode;
  /** The longer explanation, behind a "How it works" toggle. */
  info?: React.ReactNode;
}) {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finder = useMatchmaking(match);
  const now = useTicker(finder.searching);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, name }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string; token?: string; error?: string };
      if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
      saveSeat(data.code, data.token);
      if (!progress?.name) setTrainerName(name);
      router.push(href(data.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open a duel.");
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden border-primary/40">
      <form className="grid md:grid-cols-[1fr_auto]" onSubmit={create}>
        <CardContent className="space-y-2 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> Duel a friend
          </p>
          <p className="font-display text-2xl font-bold uppercase">{heading}</p>
          <p className="text-sm text-muted-foreground">{blurb}</p>
          {children}
          {info && <HowItWorks>{info}</HowItWorks>}
          {(error ?? finder.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? finder.error}
            </p>
          )}
        </CardContent>
        <div className="flex flex-col justify-center gap-2 p-6 pt-0 md:w-72 md:pt-6">
          <label htmlFor={id} className="hud-label">
            Your trainer name
          </label>
          <input
            id={id}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={24}
            required
            disabled={finder.searching}
            placeholder="Trainer name"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {finder.searching ? (
            <div className="space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status">
              <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching for an opponent…
              </p>
              <p className="font-pixel text-xs tabular-nums text-muted-foreground">{clock(now - (finder.since ?? now))}</p>
              <Button type="button" size="sm" variant="ghost" onClick={finder.cancel}>
                <X className="h-3.5 w-3.5" aria-hidden /> Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button type="submit" size="lg" disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
                Create duel
              </Button>
              {match && (
                <Button type="button" size="lg" variant="outline" disabled={busy || !name.trim()} onClick={() => (isCleanName(name) ? void finder.search(name.trim()) : setError(NAME_REJECTED))}>
                  <UserSearch className="h-4 w-4" aria-hidden /> Find an opponent
                </Button>
              )}
            </>
          )}
          {match && !finder.searching && (
            <p className="text-center text-xs text-muted-foreground">Create a duel and send the link, or get paired with anyone searching for the same game right now.</p>
          )}
        </div>
      </form>
    </Card>
  );
}
