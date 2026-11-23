"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import type { Roster, TierListLocal } from "@/lib/tier-list/types";

/**
 * The picker loads in the browser only (it keeps the run on this device); until then a skeleton with the same
 * geometry, so nothing jumps when it arrives. The roster is the Tier List Maker's static file (every Pokémon and
 * form), fetched while the code loads, so a visit to either tool fills the cache for the other.
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
    <div className="mt-6 animate-pulse motion-reduce:animate-none" data-testid="favorite-picker-skeleton" aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <div className="h-11 w-60 rounded-full bg-foreground/[0.06]" />
        <div className="h-10 w-28 rounded-full bg-foreground/[0.06] max-sm:hidden" />
      </div>
      <div className="mt-4 h-[560px] rounded-[28px] border border-foreground/[0.07] bg-card/60 max-sm:h-[640px]" />
    </div>
  );
}

const PickerApp = dynamic(() => import("./PickerApp"), { ssr: false, loading: Skeleton });

/** `shared`: a shared link's value (?d=); `local`: a page in another language's names (English pages send none). */
export function PickerShell({ shared, version, local }: { shared: string | null; version: number; local?: TierListLocal }) {
  const t = useT(picker);
  const [loaded, setRoster] = useState<Roster | null>(null);
  const roster = useMemo(
    () => (loaded && local ? { ...loaded, mons: loaded.mons.map((m) => ({ ...m, n: local.names[m.k] ?? m.n, l: local.alt[m.k] ?? "" })) } : loaded),
    [loaded, local]
  );
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    loadRoster(version).then(setRoster, () => setFailed(true));
  }, [version]);
  useEffect(load, [load]);
  if (failed)
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center" data-testid="favorite-picker-error">
        <p className="text-muted-foreground">{t("loadError")}</p>
        <button type="button" onClick={load} className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:brightness-110">
          {t("retry")}
        </button>
      </div>
    );
  if (!roster) return <Skeleton />;
  return <PickerApp roster={roster} shared={shared} />;
}
