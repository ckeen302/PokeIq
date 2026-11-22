"use client";

import { createContext } from "react";
import type { SizeItem } from "@/lib/sizes/types";

/**
 * A page in another language's names for /pokedex/sizes (built on the server: ./local): each figure's name where it
 * differs from English, the other spellings its search accepts besides English (Japanese rōmaji), and the type names
 * for the badges. English pages have none.
 */
export interface SizesLocal {
  names: Record<string, string>;
  alt: Record<string, string[]>;
  types: Record<string, string>;
}

/** The page's names, for the table under the 3D view (which rebuilds its rows from /api/sizes' English data). */
export const SizesLocalContext = createContext<SizesLocal | undefined>(undefined);

/** /api/sizes' figures with the page language's names; `alt` gets every other name the search accepts (English first). */
export function localizeItems(all: SizeItem[], local: SizesLocal, alt?: Map<string, string[]>): SizeItem[] {
  return all.map((i) => {
    const own = local.names[i.key];
    if (alt && i.kind !== "ref") alt.set(i.key, [...(own ? [i.name] : []), ...(local.alt[i.key] ?? [])]);
    return own ? { ...i, name: own } : i;
  });
}
