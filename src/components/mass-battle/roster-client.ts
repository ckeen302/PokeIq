import type { Roster } from "@/lib/mass-battle/types";

/** The roster, fetched once per visit (a static file). */
let roster: Promise<Roster> | null = null;

export function getRoster(): Promise<Roster> {
  roster ??= fetch("/api/mass-battle/roster")
    .then((r) => {
      if (!r.ok) throw new Error(`The roster didn't load (${r.status})`);
      return r.json() as Promise<Roster>;
    })
    .catch((e) => {
      roster = null;
      throw e;
    });
  return roster;
}
