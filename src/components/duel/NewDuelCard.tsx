"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords } from "lucide-react";
import { pvpHref, type PvpKind, type PvpSeatResponse } from "@/lib/pvp-types";
import { saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "Duel a friend": opens a duel (POST /api/duel) and goes to its lobby, where
 * the share link is. `settings` are the game's own choices (a quiz's mode and
 * difficulty), and `children` the controls that pick them.
 */
export function NewDuelCard({
  kind,
  settings,
  heading,
  blurb,
  children,
}: {
  kind: PvpKind;
  settings?: Record<string, unknown>;
  heading: string;
  blurb: React.ReactNode;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const progress = useProgress();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/duel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, kind, name }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<PvpSeatResponse> & { error?: string };
      if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
      saveSeat(data.code, data.token);
      if (!progress?.name) setTrainerName(name);
      router.push(pvpHref(kind, data.code));
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
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <div className="flex flex-col justify-center gap-2 p-6 pt-0 md:w-72 md:pt-6">
          <label htmlFor={`duel-name-${kind}`} className="hud-label">
            Your trainer name
          </label>
          <input
            id={`duel-name-${kind}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            required
            placeholder="Trainer name"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="lg" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
            Create duel
          </Button>
        </div>
      </form>
    </Card>
  );
}
