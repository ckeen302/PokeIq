import "server-only";
import type { Locale } from "@/i18n/config";
import { buildRoster } from "@/lib/tier-list/roster.server";
import { tierListLocal } from "@/lib/tier-list/local";
import { TYPES, type Mon, type TypeName } from "@/lib/tier-list/types";
import { refCodec, type SharedResult } from "./link";

/**
 * A shared result's Pokémon on the server (its page's title, its preview card): the link's numbers and form ids
 * looked up in the roster, named in the page's language. Pokémon the roster no longer has are left out.
 */

export interface ResolvedSlot {
  mon: Mon;
  shiny: boolean;
}

export interface ResolvedResult {
  top: ResolvedSlot[];
  chart: { type: TypeName; slot: ResolvedSlot }[];
  chartFirst: boolean;
}

export function resolveShared(r: SharedResult, locale: Locale = "en"): ResolvedResult {
  const mons = buildRoster().mons;
  const codec = refCodec(mons);
  const byKey = new Map(mons.map((m) => [m.k, m]));
  const names = locale === "en" ? null : tierListLocal(locale).names;
  const find = (s: { ref: number | string; shiny: boolean }): ResolvedSlot | null => {
    const k = codec.key(s.ref);
    const m = k ? byKey.get(k) : undefined;
    return m ? { mon: names ? { ...m, n: names[m.k] ?? m.n } : m, shiny: s.shiny } : null;
  };
  const top = r.top.map(find).filter((s): s is ResolvedSlot => !!s);
  const chart = TYPES.flatMap((type) => {
    const s = r.chart[type];
    const found = s ? find(s) : null;
    return found ? [{ type, slot: found }] : [];
  });
  return { top, chart, chartFirst: !!r.chartFirst || !top.length };
}
