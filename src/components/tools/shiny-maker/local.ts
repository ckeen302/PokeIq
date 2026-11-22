"use client";

import { createContext } from "react";
import type { Species } from "@/lib/shiny-maker/data";

/**
 * A page in another language's names for the Shiny Pokémon Maker (built on the server: lib/shiny-maker/local):
 * every Pokémon's name, the other names the picker takes (folded, space separated), and the parts' names by their
 * English. English pages have none.
 */
export interface ShinyLocal {
  names: Record<number, string>;
  alt: Record<number, string>;
  parts: Record<string, string>;
}

export const ShinyLocalContext = createContext<ShinyLocal | undefined>(undefined);

/** A species with its name and its parts' labels in the page's language (the parts keep their English `n`). */
export function localizeSpecies(sp: Species, local: ShinyLocal): Species {
  return { ...sp, name: local.names[sp.id] ?? sp.name, parts: sp.parts.map((p) => ({ ...p, l: local.parts[p.n] ?? p.n })) };
}
