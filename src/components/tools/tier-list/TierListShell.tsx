"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import type { Roster } from "@/lib/tier-list/types";
import { PillButton } from "./ui";

/**
 * The maker loads in the browser only (it measures panels and keeps work in this browser); until then a skeleton
 * with the same geometry, so nothing jumps when it arrives. The roster (every Pokémon and form) is one static JSON
 * file, fetched while the code loads and kept for the rest of the visit.
 */

let rosterPromise: Promise<Roster> | null = null;
function loadRoster(version: number): Promise<Roster> {
  rosterPromise ??= fetch(`/tools/tier-list/roster.json?v=${version}`).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<Roster>;
  });
  rosterPromise.catch(() => (rosterPromise = null));
  return rosterPromise;
}

function Skeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" data-testid="tier-list-skeleton" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-9 w-72 max-w-[70vw] rounded-lg bg-foreground/[0.07]" />
          <div className="h-4 w-40 rounded bg-foreground/[0.05]" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-28 rounded-full bg-foreground/[0.06]" />
          <div className="h-10 w-24 rounded-full bg-foreground/[0.06]" />
          <div className="h-10 w-28 rounded-full bg-primary/30" />
        </div>
      </div>
      <div className="mt-4 h-11 w-[460px] max-w-full rounded-full bg-foreground/[0.06]" />
      <div className="mt-4 grid gap-4 lg:h-[calc(100dvh-236px)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-1.5 pt-11">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-[92px] overflow-hidden rounded-2xl bg-foreground/[0.035] max-md:h-[70px]">
              <div className="w-[88px] bg-foreground/[0.06] max-sm:w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-[24px] border border-foreground/[0.07] bg-card/60 p-3 max-lg:h-[44svh]">
          <div className="h-11 rounded-xl bg-foreground/[0.05]" />
        </div>
      </div>
    </div>
  );
}

const TierListApp = dynamic(() => import("./TierListApp"), { ssr: false, loading: Skeleton });

export function TierListShell({ template, shared, version }: { template: string; shared: string | null; version: number }) {
  const t = useT(tierList);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    loadRoster(version).then(setRoster, () => setFailed(true));
  }, [version]);
  useEffect(load, [load]);
  if (failed)
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center" data-testid="tier-list-error">
        <p className="text-muted-foreground">{t("loadError")}</p>
        <PillButton primary onClick={load}>
          {t("retry")}
        </PillButton>
      </div>
    );
  if (!roster) return <Skeleton />;
  return <TierListApp roster={roster} template={template} shared={shared} />;
}
