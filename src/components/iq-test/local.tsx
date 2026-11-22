"use client";

import { createContext, useContext, type ReactNode } from "react";
import { monName } from "@/lib/cognitive/materials";
import type { CogLocal, TypeName } from "@/lib/cognitive/types";

/**
 * The test's material named in a page's language (Pokémon, types, type-icon labels), sent by the server. English
 * pages have none: the roster's English names and the icons' English letters show, as before.
 */
const LocalContext = createContext<CogLocal | null>(null);

export function CogLocalProvider({ local, children }: { local?: CogLocal; children: ReactNode }) {
  return local ? <LocalContext.Provider value={local}>{children}</LocalContext.Provider> : children;
}

export function useCogLocal() {
  const local = useContext(LocalContext);
  return {
    mon: (id: number) => local?.mons[id] ?? monName(id),
    type: (t: TypeName) => local?.types[t] ?? t,
    abbr: (t: TypeName) => local?.abbr[t] ?? t.slice(0, 3),
  };
}
