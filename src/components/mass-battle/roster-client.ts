import type { Roster } from "@/lib/mass-battle/types";

/** The roster and the learnsets, fetched once per visit (static files). */
let roster: Promise<Roster> | null = null;
let learnsets: Promise<Record<number, number[]>> | null = null;

function load<T>(url: string, what: string, reset: () => void): Promise<T> {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`The ${what} didn't load (${r.status})`);
      return r.json() as Promise<T>;
    })
    .catch((e) => {
      reset();
      throw e;
    });
}

export function getRoster(): Promise<Roster> {
  roster ??= load<Roster>("/api/mass-battle/roster", "roster", () => (roster = null));
  return roster;
}

/** Species id → the moves (roster move indices) it can legally learn. */
export function getLearnsets(): Promise<Record<number, number[]>> {
  learnsets ??= load<Record<number, number[]>>("/api/mass-battle/learnsets", "move lists", () => (learnsets = null));
  return learnsets;
}
