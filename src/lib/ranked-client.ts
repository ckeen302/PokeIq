"use client";

import { useCallback, useEffect, useState } from "react";
import type { RankedLeaderRow, RankedResponse, RankedStanding } from "./ranked";

/**
 * The browser's side of ranked Pokédle: the signed anonymous id the server
 * gave it (kept in localStorage; a signed-in trainer is their account
 * instead) and the trainer's standing.
 */

const ID_KEY = "pokeiq-ranked-id";

export function rankedId(): string | null {
  try {
    return window.localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

export function keepRankedId(id: string) {
  try {
    window.localStorage.setItem(ID_KEY, id);
  } catch {
    // Private mode: a new id next visit.
  }
}

export type RankedState =
  | { status: "loading" }
  /** Ranked play is off here (or the request failed): casual only. */
  | { status: "off" }
  | { status: "ready"; you: RankedStanding | null; top?: RankedLeaderRow[] };

/** The trainer's ranked standing (and with `top`, the top 100). `reload` fetches it again. */
export function useRanked({ top = false, enabled = true }: { top?: boolean; enabled?: boolean } = {}) {
  const [state, setState] = useState<RankedState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      try {
        const id = rankedId();
        const res = await fetch(`/api/pokedle/ranked${top ? "?top=1" : ""}`, { headers: id ? { "x-ranked-id": id } : {}, cache: "no-store" });
        const data = (await res.json().catch(() => null)) as RankedResponse | null;
        if (!live) return;
        if (data?.id) keepRankedId(data.id);
        if (!res.ok || !data || !data.available) return setState((s) => (s.status === "ready" ? s : { status: "off" }));
        setState({ status: "ready", you: data.you, top: data.top });
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
