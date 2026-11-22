"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MbNames } from "@/lib/mass-battle/i18n";

/**
 * Mass Battle's names on a page in another language: moves, abilities, held items, natures and types, by their
 * English name (the roster the battle fetches is English; the damage calculator reads those names). The page's
 * server sends them once through this provider; an English page renders none, and every name stays as it is.
 */

const Ctx = createContext<MbNames | null>(null);

export function MbNamesProvider({ value, children }: { value: MbNames; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface MbNameFns {
  move(name: string): string;
  ability(name: string): string;
  item(name: string): string;
  nature(name: string): string;
  /** A type by its capitalised English name ("Fire") or its id ("fire"). */
  type(name: string): string;
}

const SAME: MbNameFns = { move: (n) => n, ability: (n) => n, item: (n) => n, nature: (n) => n, type: (n) => n };

export function useMbNames(): MbNameFns {
  const n = useContext(Ctx);
  return useMemo(() => {
    if (!n) return SAME;
    const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);
    return {
      move: (x) => n.moves[x] ?? x,
      ability: (x) => n.abilities[x] ?? x,
      item: (x) => n.items[x] ?? x,
      nature: (x) => n.natures[x] ?? x,
      type: (x) => n.types[cap(x)] ?? x,
    };
  }, [n]);
}
