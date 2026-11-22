"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HAS_OTHER_LOCALES } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/locale-context";
import board from "@/messages/pokedle-board";
import { dataKey, labelOf, localCellValue, type DleLabels } from "@/lib/dle-i18n";
import type { DleColumn, DleRow } from "@/lib/dle-types";
import type { NameEntry } from "./search";

/**
 * Pokédle's names and values in the page's language, for every component under a game (the board, the Pokédex,
 * the how-to, a duel). The API sends English (names, "Fire", "1.2 m", the category); a page in another language
 * hands down its names and labels, and these turn what the API sent into that language. English pages provide
 * nothing, so everything reads exactly as sent.
 */

interface Lexicon {
  names: ReadonlyMap<number, NameEntry> | null;
  labels: DleLabels | undefined;
}

const LexiconContext = createContext<Lexicon>({ names: null, labels: undefined });

export function DleLexiconProvider({ names, labels, children }: { names: readonly NameEntry[]; labels?: DleLabels; children: ReactNode }) {
  const value = useMemo<Lexicon>(() => ({ names: labels ? new Map(names.map((e) => [e[0], e])) : null, labels }), [names, labels]);
  return <LexiconContext.Provider value={value}>{children}</LexiconContext.Provider>;
}

/** Categories ("Mouse Pokémon") by English key, in the page's language: loaded once, only when one is shown. */
let genusLoad: Promise<Record<string, string>> | null = null;
function loadGenus(locale: string): Promise<Record<string, string>> {
  // An English-only build never has another language: no chunk, no request.
  if (!HAS_OTHER_LOCALES) return Promise.resolve({});
  genusLoad ??= import(`@/data/i18n/${locale}/genus.json`).then((m: { default: Record<string, string> }) => m.default).catch(() => {
    genusLoad = null;
    return {};
  });
  return genusLoad;
}

export interface DleWords {
  labels: DleLabels | undefined;
  /** A Pokémon's name in the page's language (`english` as sent, on English pages). */
  name: (id: number, english: string) => string;
  /** The other names a Pokémon answers to in the page's language (none on English pages). */
  aliases: (id: number) => readonly string[];
  /** A board value in the page's language. */
  cell: (column: DleColumn, value: string) => string;
  type: (english: string) => string;
  color: (english: string) => string;
  region: (english: string) => string;
  /** A row with its name and values in the page's language. */
  row: (row: DleRow) => DleRow;
}

export function useDleWords(): DleWords {
  const t = useT(board);
  const { names, labels } = useContext(LexiconContext);
  return useMemo(() => {
    const name = (id: number, english: string) => names?.get(id)?.[1] ?? english;
    const cell = (column: DleColumn, value: string) => localCellValue(column, value, t, labels);
    return {
      labels,
      name,
      aliases: (id: number) => names?.get(id)?.[3] ?? [],
      cell,
      type: (s: string) => labelOf("types", s, labels),
      color: (s: string) => labelOf("colors", s, labels),
      region: (s: string) => labelOf("regions", s, labels),
      row: (r: DleRow) => {
        if (!labels) return r;
        const cells: DleRow["cells"] = {};
        for (const [k, c] of Object.entries(r.cells) as [DleColumn, NonNullable<DleRow["cells"][DleColumn]>][]) cells[k] = { ...c, value: cell(k, c.value) };
        return { ...r, name: name(r.id, r.name), cells };
      },
    };
  }, [t, names, labels]);
}

/** A category ("Mouse Pokémon", as the API sends it) in the page's language, once its words have loaded (English until then). */
export function useGenus(english: string | undefined): string | undefined {
  const { labels } = useContext(LexiconContext);
  const locale = useLocale();
  const [dict, setDict] = useState<Record<string, string> | null>(null);
  const need = Boolean(labels && english);
  useEffect(() => {
    if (!need || dict) return;
    let live = true;
    void loadGenus(locale).then((d) => live && setDict(d));
    return () => {
      live = false;
    };
  }, [need, dict, locale]);
  if (!english || !labels) return english;
  return dict?.[dataKey(english)] ?? english;
}
