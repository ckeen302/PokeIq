"use client";

import { useCallback, useEffect, useState } from "react";
import { keepRankedId, rankedId } from "./ranked-client";
import type { GeoRankedLeaderRow, GeoRankedResponse, GeoRankedStanding } from "./geo-ranked";

/**
 * The browser's side of ranked PokéGuessr: the trainer's standing from
 * /api/geo/ranked, sent with the same signed ranked id Pokédle's ranked play
 * keeps in localStorage (a signed-in trainer is their account instead).
 */

export type GeoRankedState =
  | { status: "loading" }
  /** Ranked PokéGuessr is off here (or the request failed): casual only. */
  | { status: "off" }
  | { status: "ready"; you: GeoRankedStanding | null; top?: GeoRankedLeaderRow[]; botAfterS: number };

/** The trainer's ranked PokéGuessr standing (and with `top`, the top 100). `reload` fetches it again. */
export function useGeoRanked({ top = false, enabled = true }: { top?: boolean; enabled?: boolean } = {}) {
  const [state, setState] = useState<GeoRankedState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      try {
        const id = rankedId();
        const res = await fetch(`/api/geo/ranked${top ? "?top=1" : ""}`, { headers: id ? { "x-ranked-id": id } : {}, cache: "no-store" });
        const data = (await res.json().catch(() => null)) as GeoRankedResponse | null;
        if (!live) return;
        if (data?.id) keepRankedId(data.id);
        if (!res.ok || !data || !data.available) return setState((s) => (s.status === "ready" ? s : { status: "off" }));
        setState({ status: "ready", you: data.you, top: data.top, botAfterS: data.botAfterS });
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
