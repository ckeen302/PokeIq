import ou from "@/data/smogon/gen9ou.json";
import { FACTS, type Facts } from "./facts";
import type { ConnPack } from "./pack-seed";

/**
 * The Pokémon each themed pack allows (see ./pack-seed): the Pokédex
 * snapshot and Smogon's usage stats, so server-side only.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** OU-relevant: used in at least 1% of Gen 9 OU teams (Smogon's usage stats, base forms). */
const OU_MIN_USAGE = 0.01;

function competitiveIds(): Set<number> {
  const byName = new Map<string, Facts>(FACTS.map((f) => [norm(f.name), f]));
  const ids = new Set<number>();
  for (const p of (ou as { pokemon: { species: string; usage: number }[] }).pokemon) {
    if (p.usage < OU_MIN_USAGE) continue;
    // "Landorus-Therian" is Landorus: drop form suffixes until a species matches.
    const parts = p.species.split("-");
    for (let n = parts.length; n >= 1; n--) {
      const f = byName.get(norm(parts.slice(0, n).join("-")));
      if (f) {
        ids.add(f.id);
        break;
      }
    }
  }
  return ids;
}

const cache = new Map<ConnPack, Set<number>>();

/** The Pokémon a pack allows (base-form ids). */
export function packIds(pack: ConnPack): ReadonlySet<number> {
  let ids = cache.get(pack);
  if (!ids) {
    ids = pack === "kanto" ? new Set(FACTS.filter((f) => f.gen === 1).map((f) => f.id)) : pack === "gen9" ? new Set(FACTS.filter((f) => f.gen === 9).map((f) => f.id)) : competitiveIds();
    cache.set(pack, ids);
  }
  return ids;
}
