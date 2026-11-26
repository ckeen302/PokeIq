"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { normalizeName } from "@/components/pokedle/search";
import { loadSpeciesList, type SpeciesEntry } from "@/lib/shiny-maker/data";

/**
 * Every Pokémon's name for the counter: the Shiny Pokémon Maker's species list (one small static file), in the page's
 * language when the page sends that language's names (`HuntLocal`, built on the server).
 */

export interface HuntLocal {
  names: Record<number, string>;
  /** Other names the search takes, folded and space separated (English, rōmaji). */
  alt: Record<number, string>;
}

export const HuntLocalContext = createContext<HuntLocal | undefined>(undefined);

export interface NameEntry {
  id: number;
  name: string;
  key: string;
  alt: string[];
}

export interface Names {
  ready: boolean;
  list: NameEntry[];
  name(id: number): string;
  /** The species' primary type (for its stage's colours), once the list loads. */
  type(id: number): string | null;
}

export function useNames(): Names {
  const local = useContext(HuntLocalContext);
  const [list, setList] = useState<SpeciesEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    loadSpeciesList().then(
      (l) => live && setList(l),
      () => live && setList([])
    );
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const entries: NameEntry[] = (list ?? []).map(([id, english]) => {
      const name = local?.names[id] ?? english;
      return { id, name, key: normalizeName(name), alt: local ? (local.alt[id] ?? "").split(" ").filter(Boolean) : [] };
    });
    const byId = new Map(entries.map((e) => [e.id, e.name]));
    const types = new Map((list ?? []).map(([id, , type]) => [id, type]));
    return { ready: list !== null, list: entries, name: (id: number) => byId.get(id) ?? local?.names[id] ?? `#${id}`, type: (id: number) => types.get(id) ?? null };
  }, [list, local]);
}
