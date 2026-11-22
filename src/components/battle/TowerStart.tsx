"use client";

import { useCallback, useMemo, useState } from "react";
import { Castle, Loader2 } from "lucide-react";
import type { FrontierRunView } from "@/lib/battle/frontier";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { GUEST_TRAINER } from "@/lib/battle/play";
import { setTrainerName } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeamPick, type TeamSource } from "./TeamPick";
import { useT } from "@/i18n/client";
import frontierNs from "@/messages/battle-frontier";

/** Entering the Battle Tower: your team (saved, built or quick), checked by Showdown for Flat Rules. */
export function TowerStart({ name, onRun }: { name: string; onRun: (run: FrontierRunView) => void }) {
  const t = useT(frontierNs);
  const source = useMemo<TeamSource>(
    () => ({ name: t("tower.source"), short: t("tower.short"), saved: "gen9ou", quick: { tower: true }, quickNote: t("tower.quickNote") }),
    [t]
  );
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTeam = useCallback((t: string) => setTeam(t), []);

  async function enter() {
    // The Tower is against the computer: a name is optional.
    const who = name || GUEST_TRAINER;
    if (!isCleanName(who)) return setError(t.locale === "en" ? NAME_REJECTED : t("nameRejected"));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/battle/frontier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", mode: "tower", name: who, team }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: FrontierRunView; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error ?? t("requestFailed", { status: res.status }));
      if (name) setTrainerName(name);
      onRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tower.enterFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t("tower.rules")}</p>
        <TeamPick format="tower" onChange={onTeam} idPrefix="tower" source={source} />
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="tower-error">
            {error}
          </p>
        )}
        <Button size="lg" onClick={() => void enter()} disabled={busy || !team} data-testid="tower-enter">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Castle className="h-4 w-4" aria-hidden />} {t("tower.enter")}
        </Button>
      </CardContent>
    </Card>
  );
}
