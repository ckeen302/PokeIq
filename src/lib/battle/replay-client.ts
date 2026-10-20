"use client";

import { rankedId } from "@/lib/ranked-client";

/**
 * The browser's side of battle identity and replays: the signed id battles
 * know this trainer by (shared with ranked Pokédle; a signed-in trainer is
 * their account), and the replays this device remembers.
 */

const ID_KEY = "pokeiq-ranked-id";
const REPLAYS_KEY = "pokeiq:battle:replays";

let pending: Promise<string | null> | null = null;

/** This browser's signed id, asking the server for one the first time. */
export function ensureBattleId(): Promise<string | null> {
  const have = rankedId();
  if (have) return Promise.resolve(have);
  pending ??= fetch("/api/battle/id", { cache: "no-store" })
    .then((res) => res.json())
    .then((data: { id?: string }) => {
      if (data.id) {
        try {
          window.localStorage.setItem(ID_KEY, data.id);
        } catch {
          // Private mode: a new id next visit.
        }
      }
      return data.id ?? rankedId();
    })
    .catch(() => null)
    .finally(() => (pending = null));
  return pending;
}

/** Replay ids this device saved or played in, newest first. */
export function rememberedReplays(): string[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(REPLAYS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function rememberReplay(id: string) {
  try {
    const list = [id, ...rememberedReplays().filter((r) => r !== id)].slice(0, 50);
    window.localStorage.setItem(REPLAYS_KEY, JSON.stringify(list));
  } catch {
    // not remembered on this device
  }
}

/** Headers that identify this trainer to the battle API. */
export function battleIdHeaders(): Record<string, string> {
  const id = rankedId();
  return id ? { "x-ranked-id": id } : {};
}
