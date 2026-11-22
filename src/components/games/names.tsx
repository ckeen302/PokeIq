"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Athlete } from "@/lib/games/athlete";
import type { Entrant } from "@/lib/race/types";
import { searchEntrants } from "@/lib/race/lineup";

/**
 * The athletes' names on a page in another language. /api/games serves the roster in English; the page's server
 * sends that language's names (lib/games/names) once, through this provider, and the 3D view, the pickers and the
 * broadcast read them from here. An English page renders no provider: every name stays as it was.
 */

export interface NamesValue {
  names: Record<string, string>;
  /** Other names a search takes (English, rōmaji). */
  aliases: Record<string, string[]>;
  /** Types' names ("fire" → "Fuego"), for the nations. */
  types: Record<string, string> | null;
}

const NamesContext = createContext<NamesValue | null>(null);

export function GamesNamesProvider({ value, children }: { value: NamesValue; children: ReactNode }) {
  return <NamesContext.Provider value={value}>{children}</NamesContext.Provider>;
}

export const useGamesNames = () => useContext(NamesContext);

/** The roster with the page's names (as given on an English page). */
export function localizeAthletes(list: Athlete[], n: NamesValue | null): Athlete[] {
  if (!n) return list;
  return list.map((a) => {
    const name = n.names[a.key];
    return name ? { ...a, name, entrant: { ...a.entrant, name } } : a;
  });
}

/** The extra entrants a search also matches (each alias as an entrant's name), or null on an English page. */
export function aliasEntrants(list: Athlete[], n: NamesValue | null): Entrant[] | null {
  if (!n) return null;
  const out: Entrant[] = [];
  for (const a of list) for (const alias of n.aliases[a.key] ?? []) out.push({ ...a.entrant, name: alias });
  return out;
}

/** searchEntrants over the page's names, then over the aliases (each result once, by its own name). */
export function searchAthletes(entrants: Entrant[], alt: Entrant[] | null, q: string, limit: number): Entrant[] {
  const main = searchEntrants(entrants, q, limit);
  if (!alt || main.length >= limit) return main;
  const byKey = new Map(entrants.map((e) => [e.key, e]));
  const seen = new Set(main.map((e) => e.key));
  const out = [...main];
  for (const e of searchEntrants(alt, q, limit * 2)) {
    if (out.length >= limit) break;
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(byKey.get(e.key) ?? e);
  }
  return out;
}
