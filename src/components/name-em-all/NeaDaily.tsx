"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { neaCategory, neaDailyCategory } from "@/lib/name-em-all/categories";
import type { NeaOutsider, NeaTarget } from "@/lib/name-em-all/types";
import { useToday } from "@/lib/use-today";
import type { Locale } from "@/i18n/config";
import { useT } from "@/i18n/client";
import neaDaily from "@/messages/nea-daily";
import { NameEmAll } from "./NameEmAll";

export interface NeaTargetsResponse {
  category: string;
  targets: NeaTarget[];
  outsiders: NeaOutsider[];
  /** Another language only: the category's label and heading there. */
  label?: string;
  h1?: string;
}

/**
 * A category's slots from the static targets endpoint, in the page's language (another language's version sits under
 * its code): null while loading, `error` true if it failed.
 */
export function useNeaTargets(category: string | null, locale: Locale) {
  const [data, setData] = useState<NeaTargetsResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!category) return;
    let live = true;
    setData(null);
    setError(false);
    fetch(locale === "en" ? `/api/name-em-all/targets/${category}` : `/api/name-em-all/targets/${category}/${locale}`)
      .then((r) => (r.ok ? (r.json() as Promise<NeaTargetsResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [category, locale]);
  return { data, error };
}

/** The day's category (by the player's local date), played with the daily's fixed settings. */
export function NeaDaily() {
  const today = useToday();
  const id = today ? neaDailyCategory(today) : null;
  const t = useT(neaDaily);
  const found = id ? neaCategory(id) : undefined;
  const { data, error } = useNeaTargets(id, t.locale);
  // Another language's label and heading come with the day's Pokémon.
  const cat = found && (t.locale === "en" ? found : data?.label && data.h1 ? { ...found, label: data.label, h1: data.h1 } : undefined);
  return (
    <div className="space-y-6">
      <header className="mx-auto max-w-3xl space-y-2 text-center">
        <p className="hud-label text-screen">{t("eyebrow", { date: today ?? "" })}</p>
        {/* Two lines tall from the start: the day's title (local date) replaces the placeholder after load. */}
        <h1 className="flex min-h-[4.5rem] items-center justify-center font-display text-3xl font-bold uppercase tracking-tight sm:min-h-24 sm:text-5xl" data-testid="nea-daily-title">
          {cat ? cat.h1 : t("fallback")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </header>
      {/* Hold about the start card's height while today's Pokémon load, so the page doesn't jump when it appears. */}
      <div className="min-h-[48rem] sm:min-h-[34rem]">
        {error ? (
          <p className="text-center text-destructive">{t("failed")}</p>
        ) : !data || !cat || !today ? (
          <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("loading")}
          </p>
        ) : (
          <NameEmAll key={today} category={{ id: cat.id, label: cat.label }} targets={data.targets} outsiders={data.outsiders} daily={today} />
        )}
      </div>
    </div>
  );
}
