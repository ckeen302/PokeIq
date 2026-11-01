import "server-only";
import timeline from "@/data/pokemon-timeline.json";
import geo from "@/data/geo.json";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { firstDate, type TimelineRaw } from "@/lib/timeline/types";
import { REGION_ORIGINS } from "@/lib/region-origins";
import { LAST_GEN, regionGeneration } from "./era";

/**
 * What the globe's region cards and era filter say, built at build time from
 * the repo's own data: generation from the Pokédex's version table, games and
 * starters from the history timeline (src/data/pokemon-timeline.json, every
 * row sourced), and links only where the target exists (a PokéGuessr map, a
 * Pokédex places filter). Anything the data lacks is left off.
 */

export interface GlobeRegionCard {
  name: string;
  gen: number;
  /** Year of the region's first game. */
  year: number | null;
  /** The main-series games set there, oldest first. */
  games: { title: string; year: number }[];
  /** The first game's starters (or partner), with Pokédex names. */
  starters: { id: number; name: string }[];
  /** /guessr?region=… when PokéGuessr has a map of the region. */
  guessr: string | null;
  /** /pokedex/places?region=… when the Places tab lists it. */
  places: string | null;
  origin: string | null;
}

export interface GlobeEra {
  gen: number;
  year: number | null;
  /** The regions it adds (main regions, by first game). */
  regions: string[];
}

/** The main regions, as the atlas names them (its tier-1 labels). */
export const GLOBE_MAIN_REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"] as const;

const RAW = (timeline as unknown as TimelineRaw[]).filter((e) => e.lane === "games");
const W = geo as unknown as { world: { crops: Record<string, { regions: string[] }>; locations: { region: string }[] } };
const PLACE_REGIONS = new Set(W.world.locations.map((l) => l.region));
const yearOf = (e: TimelineRaw) => Number(firstDate(e).slice(0, 4));
const shortTitle = (t: string) => t.replace(/^Pokémon:?\s+/, "");

export function globeRegionCards(): GlobeRegionCard[] {
  return GLOBE_MAIN_REGIONS.flatMap((name) => {
    const gen = regionGeneration(name);
    if (gen === null) return [];
    const rows = RAW.filter((e) => e.region === name && e.kind !== "rerelease").sort((a, b) => yearOf(a) - yearOf(b));
    const opener = rows.find((e) => e.kind === "opener") ?? null;
    const crop = Object.entries(W.world.crops).find(([, c]) => c.regions.includes(name));
    return [
      {
        name,
        gen,
        year: opener ? yearOf(opener) : null,
        games: rows.map((e) => ({ title: shortTitle(e.title), year: yearOf(e) })),
        starters: (opener?.starters ?? []).flatMap((id) => {
          const p = getPokemon(id);
          return p ? [{ id, name: p.name }] : [];
        }),
        guessr: crop ? `/guessr?region=${encodeURIComponent(crop[0])}` : null,
        places: PLACE_REGIONS.has(name) ? `/pokedex/places?region=${encodeURIComponent(name)}` : null,
        origin: REGION_ORIGINS[name] ?? null,
      },
    ];
  });
}

export function globeEras(cards = globeRegionCards()): GlobeEra[] {
  return Array.from({ length: LAST_GEN }, (_, i) => {
    const gen = i + 1;
    const adds = cards.filter((c) => c.gen === gen);
    const years = adds.map((c) => c.year).filter((y): y is number => y !== null);
    return { gen, year: years.length ? Math.min(...years) : null, regions: adds.map((c) => c.name) };
  });
}
