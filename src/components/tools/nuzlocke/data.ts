"use client";

import { useEffect, useState } from "react";
import type { GameView } from "@/lib/nuzlocke/view";

/** A game's data for the screens (/tools/nuzlocke-tracker/<game>/data.json, built with the site), fetched once a visit. */
const cache = new Map<string, Promise<GameView>>();

export function loadView(game: string, data = ""): Promise<GameView> {
  const key = `${game}@${data}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/tools/nuzlocke-tracker/${encodeURIComponent(game)}/data.json${data ? `?v=${data}` : ""}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<GameView>;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** The views of these games, as they arrive (a game that failed to load is just missing). */
export function useViews(games: { id: string; data: string }[]): Record<string, GameView> {
  const [views, setViews] = useState<Record<string, GameView>>({});
  const key = games.map((g) => `${g.id}@${g.data}`).join(",");
  useEffect(() => {
    let live = true;
    for (const g of games) loadView(g.id, g.data).then((v) => live && setViews((s) => ({ ...s, [g.id]: v })), () => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the games' ids and data versions
  }, [key]);
  return views;
}
