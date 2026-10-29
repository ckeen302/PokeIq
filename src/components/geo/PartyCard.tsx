"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Heart, Loader2, LogIn, Users } from "lucide-react";
import { saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { PARTY_CODE_RE, PARTY_DEFAULT_LIVES, PARTY_MAX_PLAYERS, PARTY_MODE_NAMES, PARTY_TEAM_HP, partyPath, type PartyMode } from "@/lib/geo-party";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BLURB: Record<PartyMode, string> = {
  royale: `Up to ${PARTY_MAX_PLAYERS} trainers on the same places. Lowest score each round loses a life (${PARTY_DEFAULT_LIVES} each); last trainer standing wins.`,
  team: `Red team against blue, 2v2 (up to 4v4), ${PARTY_TEAM_HP.toLocaleString("en-US")} HP a team. Your team scores its best pin, and you see your teammates' pins live.`,
};

/**
 * Party on /guessr: open a private room (the host picks the game in its
 * lobby) or join one with its six-letter code.
 */
export function PartyCard({ region }: { region: GeoRegionInfo }) {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<PartyMode>("royale");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/geo/party", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, region: region.id, mode }) });
      const data = (await res.json().catch(() => ({}))) as { code?: string; token?: string; error?: string };
      if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
      saveSeat(data.code, data.token);
      if (!progress?.name) setTrainerName(name);
      router.push(partyPath(data.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open a party.");
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toLowerCase();
    if (!PARTY_CODE_RE.test(c)) return setError("Room codes are six letters and numbers.");
    router.push(partyPath(c));
  }

  return (
    <Card className="overflow-hidden border-primary/40" data-testid="geo-party-new">
      <div className="grid md:grid-cols-[1fr_auto]">
        <CardContent className="space-y-3 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Users className="h-3.5 w-3.5" aria-hidden /> Party · up to {PARTY_MAX_PLAYERS} trainers
          </p>
          <p className="font-display text-2xl font-bold uppercase">Private room · {region.name}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Party game">
            {(["royale", "team"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                data-testid={`geo-party-mode-${m}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                  mode === m ? "border-primary bg-primary/15 text-foreground" : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {m === "royale" ? <Heart className="h-3.5 w-3.5" aria-hidden /> : <Users className="h-3.5 w-3.5" aria-hidden />}
                {PARTY_MODE_NAMES[m]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{BLURB[mode]}</p>
          <p className="text-xs text-muted-foreground">You host: change the map, lives, timer and rounds in the lobby, then start when everyone is in.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <div className="flex flex-col justify-center gap-2 p-6 pt-0 md:w-72 md:pt-6">
          <form className="flex flex-col gap-2" onSubmit={create}>
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
              placeholder="Trainer name"
              data-testid="geo-party-name"
              className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="lg" disabled={busy || !name.trim()} data-testid="geo-party-create">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Crown className="h-4 w-4" aria-hidden />}
              Create party
            </Button>
          </form>
          <form className="flex gap-2 pt-1" onSubmit={join}>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6));
                setError(null);
              }}
              aria-label="Room code"
              placeholder="Room code"
              autoCapitalize="characters"
              data-testid="geo-party-code"
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm uppercase tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" variant="outline" disabled={code.length !== 6}>
              <LogIn className="h-4 w-4" aria-hidden /> Join
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
