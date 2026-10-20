"use client";

import { useCallback, useState } from "react";
import { Castle, Loader2 } from "lucide-react";
import type { FrontierRunView } from "@/lib/battle/frontier";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeamPick, type TeamSource } from "./TeamPick";

const SOURCE: TeamSource = {
  name: "Battle Tower · Flat Rules",
  short: "Flat Rules",
  saved: "gen9ou",
  quick: { tower: true },
  quickNote: "Battle Stadium sets, legal under Flat Rules.",
};

/** Entering the Battle Tower: your team (saved, built or quick), checked by Showdown for Flat Rules. */
export function TowerStart({ name, onRun }: { name: string; onRun: (run: FrontierRunView) => void }) {
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTeam = useCallback((t: string) => setTeam(t), []);

  async function enter() {
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/battle/frontier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", mode: "tower", name, team }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: FrontierRunView; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error ?? `Request failed (${res.status})`);
      setTrainerName(name);
      onRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enter the Tower.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">
          Flat Rules, as Pokémon Showdown plays them: every Pokémon at level 50, bring six and pick three after seeing your opponent&apos;s team, Species, Item and
          Nickname Clauses, no Mythical or Restricted Legendary Pokémon. Seven wins clear a round; the seventh trainer is the Tower Tycoon.
        </p>
        <TeamPick format="tower" onChange={onTeam} idPrefix="tower" source={SOURCE} />
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="tower-error">
            {error}
          </p>
        )}
        <Button size="lg" onClick={() => void enter()} disabled={busy || !team || !name} data-testid="tower-enter">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Castle className="h-4 w-4" aria-hidden />} Enter the Tower
        </Button>
        {!name && <p className="text-xs text-muted-foreground">Pick a trainer name first.</p>}
      </CardContent>
    </Card>
  );
}
