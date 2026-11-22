"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import type { NameEntry } from "@/components/pokedle/search";

/** Every Pokémon's [id, name, gen] for the guess box, fetched once per page-life. */
let names: Promise<NameEntry[]> | null = null;

function load(): Promise<NameEntry[]> {
  names ??= fetch("/api/zoom-reveal/names")
    .then((r) => (r.ok ? (r.json() as Promise<NameEntry[]>) : Promise.reject(new Error(`names ${r.status}`))))
    .catch((err) => {
      names = null;
      throw err;
    });
  return names;
}

/**
 * A page in another language hands the guess box its names from the server instead (src/lib/dle-lexicon.ts
 * dleNames): each Pokémon in that language, with the other names it answers to. English pages render none.
 */
const Provided = createContext<NameEntry[] | null>(null);

export function DexNamesProvider({ names: list, children }: { names: NameEntry[]; children: ReactNode }) {
  return createElement(Provided.Provider, { value: list }, children);
}

export function useDexNames(): NameEntry[] | null {
  const provided = useContext(Provided);
  const [list, setList] = useState<NameEntry[] | null>(null);
  useEffect(() => {
    if (provided) return;
    let live = true;
    const get = (attempt: number) =>
      load().then(
        (l) => live && setList(l),
        () => live && attempt < 3 && window.setTimeout(() => get(attempt + 1), 800 * (attempt + 1))
      );
    get(0);
    return () => {
      live = false;
    };
  }, [provided]);
  return provided ?? list;
}
