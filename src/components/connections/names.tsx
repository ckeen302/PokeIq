"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

/**
 * Tiles' names in the page's language: the server sends a page in another language its language's Pokémon names
 * (src/lib/connections/names.ts, by Pokédex number, only those that differ from English), and every tile, bar and
 * "Why?" line reads them here. An English page has no provider: tiles show the names the API sent, as always.
 */
const NamesContext = createContext<Readonly<Record<number, string>> | null>(null);

export function ConnNamesProvider({ names, children }: { names: Readonly<Record<number, string>> | null | undefined; children: ReactNode }) {
  if (!names) return children;
  return <NamesContext.Provider value={names}>{children}</NamesContext.Provider>;
}

/** A tile's name as the page shows it. */
export function useTileName(): (tile: { id: number; name: string }) => string {
  const names = useContext(NamesContext);
  return useCallback((tile: { id: number; name: string }) => names?.[tile.id] ?? tile.name, [names]);
}
