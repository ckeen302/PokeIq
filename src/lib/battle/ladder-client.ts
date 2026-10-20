"use client";

import { useEffect, useState } from "react";
import type { RankedStanding } from "@/lib/ranked";
import type { StandardFormatId } from "./play";
import type { LadderResponse } from "./ladder";
import { battleIdHeaders } from "./replay-client";

const ID_KEY = "pokeiq-ranked-id";

export type LadderState = { status: "loading" } | { status: "off" } | { status: "ready"; you: RankedStanding | null };

/** Your standing on one format's ladder (keeping the signed id the server hands a new browser). */
export function useLadderStanding(format: StandardFormatId | null, tick = 0): LadderState {
  const [state, setState] = useState<LadderState>({ status: "loading" });
  useEffect(() => {
    if (!format) return;
    let live = true;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/battle/ladder?format=${format}`, { headers: battleIdHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => null)) as LadderResponse | null;
        if (!live) return;
        if (data?.id) {
          try {
            window.localStorage.setItem(ID_KEY, data.id);
          } catch {
            // a new id next visit
          }
        }
        setState(res.ok && data?.available ? { status: "ready", you: data.you } : { status: "off" });
      } catch {
        if (live) setState({ status: "off" });
      }
    })();
    return () => {
      live = false;
    };
  }, [format, tick]);
  return state;
}
