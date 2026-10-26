"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { neaCategory, neaDailyCategory } from "@/lib/name-em-all/categories";
import type { NeaTarget } from "@/lib/name-em-all/types";
import { useToday } from "@/lib/use-today";
import { NameEmAll } from "./NameEmAll";

export interface NeaTargetsResponse {
  category: string;
  targets: NeaTarget[];
  outsiders: string[];
}

/** A category's slots from the static targets endpoint (null while loading, an error message if it failed). */
export function useNeaTargets(category: string | null) {
  const [data, setData] = useState<NeaTargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!category) return;
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/name-em-all/targets/${category}`)
      .then((r) => (r.ok ? (r.json() as Promise<NeaTargetsResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setError("Couldn't load the Pokémon. Check your connection and reload."));
    return () => {
      live = false;
    };
  }, [category]);
  return { data, error };
}

/** The day's category (by the player's local date), played with the daily's fixed settings. */
export function NeaDaily() {
  const today = useToday();
  const id = today ? neaDailyCategory(today) : null;
  const cat = id ? neaCategory(id) : undefined;
  const { data, error } = useNeaTargets(id);
  return (
    <div className="space-y-6">
      <header className="mx-auto max-w-3xl space-y-2 text-center">
        <p className="hud-label text-screen">Name &apos;em All · Daily {today ?? ""}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl" data-testid="nea-daily-title">
          {cat ? cat.h1 : "Today's category"}
        </h1>
        <p className="text-sm text-muted-foreground">One category a day, the same for everyone. One ranked try: Regular mode, the standard time, no hints or pauses.</p>
      </header>
      {error ? (
        <p className="text-center text-destructive">{error}</p>
      ) : !data || !cat || !today ? (
        <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading today&apos;s Pokémon…
        </p>
      ) : (
        <NameEmAll key={today} category={{ id: cat.id, label: cat.label }} targets={data.targets} outsiders={data.outsiders} daily={today} />
      )}
    </div>
  );
}
