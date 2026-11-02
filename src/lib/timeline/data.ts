import "server-only";
import raw from "@/data/pokemon-timeline.json";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PLACES } from "@/lib/dex/places-data";
import { generationAt } from "./derive";
import { eraOfGen, firstDate, yearFrac, type TimelineEntry, type TimelineRaw, type TimelineSpecies } from "./types";

/** Build-time view of the timeline for /pokedex/timeline: dates parsed, species and region links resolved. */

const RAW = raw as unknown as TimelineRaw[];
const BY_ID = new Map(POKEDEX.map((p) => [p.id, p]));
const PLACE_REGIONS = new Set(PLACES.map((p) => p.region));
const OPENERS = RAW.filter((e) => e.lane === "games" && e.kind === "opener").map((e) => ({ generation: e.generation, t: yearFrac(firstDate(e)) }));

const sp = (id: number): TimelineSpecies => {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`timeline: no species ${id}`);
  return { id: p.id, slug: p.slug, name: p.name };
};

export const TIMELINE: TimelineEntry[] = RAW.map((e) => {
  const first = firstDate(e);
  const t = yearFrac(first);
  return {
    id: e.id,
    lane: e.lane,
    title: e.title,
    platform: e.platform,
    date_jp: e.date_jp,
    date_na: e.date_na,
    date_eu: e.date_eu,
    worldwide: !!e.worldwide,
    generation: e.generation,
    region: e.region,
    regionHref: e.region && PLACE_REGIONS.has(e.region) ? `/pokedex/places?region=${encodeURIComponent(e.region)}` : null,
    kind: e.kind ?? null,
    note: e.note ?? null,
    series: e.series ?? null,
    t: Math.round(t * 10000) / 10000,
    // The era it sits in on the timeline: FireRed on Switch (2026) is a Gen 3 game in the Switch era.
    era: eraOfGen(generationAt(t, OPENERS)).id,
    starters: (e.starters ?? []).map(sp),
    legendaries: (e.legendaries ?? []).map(sp),
    introduces: e.lane === "games" && e.kind === "opener" ? e.generation : null,
    setHref: e.set ? `/pokedex/tcg/${e.set}` : null,
    featured: !!e.featured,
    sources: e.sources,
  };
});

/** The species a generation introduced, in National Dex order (the Pokédex's own `gen` field). */
export function speciesOfGen(gen: number): TimelineSpecies[] {
  return POKEDEX.filter((p) => p.gen === gen).map((p) => ({ id: p.id, slug: p.slug, name: p.name }));
}
