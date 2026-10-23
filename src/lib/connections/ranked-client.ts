"use client";

import { useCallback, useEffect, useState } from "react";
import type { RankedLeaderRow, RankedStanding } from "@/lib/ranked";
import { keepRankedId, rankedId } from "@/lib/ranked-client";
import type { ConnRankedResponse } from "./ranked";

/**
 * The browser's side of ranked PokéConnections: the trainer's standing this
 * season (and the ladder). It sends the same signed ranked id as ranked
 * Pokédle, so a trainer is one trainer on both ladders.
 */

export type ConnRankedState =
  | { status: "loading" }
  /** Ranked play is off here (or the request failed): casual only. */
  | { status: "off" }
  | { status: "ready"; season: string; endsAt: number; you: RankedStanding | null; top?: RankedLeaderRow[] };

export function useConnRanked({ top = false, enabled = true }: { top?: boolean; enabled?: boolean } = {}) {
  const [state, setState] = useState<ConnRankedState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      try {
        const id = rankedId();
        const res = await fetch(`/api/connections/ranked${top ? "?top=1" : ""}`, { headers: id ? { "x-ranked-id": id } : {}, cache: "no-store" });
        const data = (await res.json().catch(() => null)) as ConnRankedResponse | null;
        if (!live) return;
        if (data?.id) keepRankedId(data.id);
        if (!res.ok || !data || !data.available) return setState((s) => (s.status === "ready" ? s : { status: "off" }));
        setState({ status: "ready", season: data.season, endsAt: data.endsAt, you: data.you, top: data.top });
      } catch {
        if (live) setState((s) => (s.status === "ready" ? s : { status: "off" }));
      }
    })();
    return () => {
      live = false;
    };
  }, [top, enabled, tick]);
  return { state, reload };
}
