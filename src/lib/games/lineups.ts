import { STARTER_BASES } from "@/lib/race/presets";
import type { Athlete } from "./athlete";
import { mulberry32, shuffle } from "@/lib/race/tournament";

/**
 * Fun line-ups for a single event, picked from the data (never ranked by
 * hand): heavyweights against featherweights, the fully evolved starters,
 * the Legendaries, a type's best-known lines, the fan favourites, or eight
 * at random. Pure.
 */

/** Pokémon people know best (a fixed list of species, no stats involved). */
export const FAVOURITES = ["pikachu", "charizard", "snorlax", "gengar", "lucario", "eevee", "gyarados", "mewtwo", "greninja", "garchomp", "machamp", "blastoise", "dragonite", "jigglypuff", "psyduck", "bulbasaur", "squirtle", "magikarp", "wailord", "shuckle", "blissey", "onix", "rayquaza", "mimikyu"];

export interface Lineup {
  id: string;
  label: string;
  keys: string[];
}

const species = (all: Athlete[]) => all.filter((a) => a.entrant.kind === "pokemon");

export function lineups(all: Athlete[], seed: number): Lineup[] {
  const sp = species(all);
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[], n: number) => shuffle(xs, Math.floor(rnd() * 1e9)).slice(0, n);
  const byWeight = [...sp].sort((a, b) => b.kg - a.kg);
  const starters = (() => {
    const chains = new Set(sp.filter((a) => (STARTER_BASES as readonly number[]).includes(a.entrant.species)).map((a) => a.entrant.chain));
    return sp.filter((a) => chains.has(a.entrant.chain) && a.entrant.evolved);
  })();
  const legends = sp.filter((a) => a.entrant.legendary);
  const types = ["fire", "water", "grass", "electric", "dragon", "fighting", "psychic", "ghost", "steel", "fairy"];
  const t = types[Math.floor(rnd() * types.length)];
  const fav = FAVOURITES.filter((k) => sp.some((a) => a.key === k));
  return [
    { id: "giants", label: "Heavyweights vs featherweights", keys: [...pick(byWeight.slice(0, 16), 4), ...pick(byWeight.slice(-40), 4)].map((a) => a.key) },
    { id: "starters", label: "Fully evolved starters", keys: pick(starters, 8).map((a) => a.key) },
    { id: "legends", label: "Legendaries", keys: pick(legends, 8).map((a) => a.key) },
    { id: "favourites", label: "Fan favourites", keys: shuffle(fav, Math.floor(rnd() * 1e9)).slice(0, 8) },
    { id: `type-${t}`, label: `${t[0].toUpperCase()}${t.slice(1)} types`, keys: pick(sp.filter((a) => a.types.includes(t) && a.entrant.evolved), 8).map((a) => a.key) },
    { id: "random", label: "Eight at random", keys: pick(sp, 8).map((a) => a.key) },
  ];
}

/** One fun line-up, chosen by the seed. */
export function funLineup(all: Athlete[], seed: number): Lineup {
  const ls = lineups(all, seed);
  return ls[seed % ls.length];
}
