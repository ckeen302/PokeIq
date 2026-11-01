"use client";

import { useEffect, useState } from "react";
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

export function useDexNames(): NameEntry[] | null {
  const [list, setList] = useState<NameEntry[] | null>(null);
  useEffect(() => {
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
  }, []);
  return list;
}
