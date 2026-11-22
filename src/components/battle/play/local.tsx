"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, type Locale, type OtherLocale } from "@/i18n/config";
import type { LogLocal } from "@/lib/battle/log/local";
import type { BattleNames } from "@/lib/battle/log/names";

/**
 * The battle screen in another language: its log (src/lib/battle/log/local.ts) and the official names of everything
 * it shows (Pokémon, moves, abilities, items, types, natures), loaded once, only for the page's own language. English
 * pages load none of it: every name shows as the battle sends it.
 */

const same = (s: string) => s;
const ENGLISH: BattleNames = { move: same, ability: same, item: same, type: same, nature: same, species: same, pokemon: same, effect: same };

export const BattleLocalContext = createContext<LogLocal | null>(null);

/** The names in the page's language (English's own on English pages, and until another language's have arrived). */
export function useBattleNames(): BattleNames {
  return useContext(BattleLocalContext)?.names ?? ENGLISH;
}

// An English-only build never has another language: no chunk, no request (the bundler drops the import).
const loadModule = process.env.LIVE_LOCALES ? () => import("@/lib/battle/log/local") : null;

let loaded: { locale: Locale; local: LogLocal } | null = null;

/**
 * The page language's log and names: null on English pages; undefined while another language's are on their way
 * (the battle waits for them, so its log never starts in English).
 */
export function useLogLocal(locale: Locale): LogLocal | null | undefined {
  const [local, setLocal] = useState<LogLocal | null | undefined>(() => (locale === DEFAULT_LOCALE ? null : loaded?.locale === locale ? loaded.local : undefined));
  useEffect(() => {
    if (locale === DEFAULT_LOCALE || !loadModule) {
      setLocal(null);
      return;
    }
    if (loaded?.locale === locale) {
      setLocal(loaded.local);
      return;
    }
    let live = true;
    void loadModule()
      .then((m) => m.loadLogLocal(locale as OtherLocale))
      .then((l) => {
        loaded = { locale, local: l };
        if (live) setLocal(l);
      })
      // Nothing to show it in: the battle goes on in English rather than not at all.
      .catch(() => live && setLocal(null));
    return () => {
      live = false;
    };
  }, [locale]);
  return local;
}
