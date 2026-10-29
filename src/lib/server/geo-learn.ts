import "server-only";
import { PLACES, gymsFor, wildAt, type PlaceRecord } from "@/lib/dex/places-data";
import { placeKey } from "@/lib/dex/places";
import type { GeoLearn } from "@/lib/geo-learn-types";

/**
 * The learn card's one fact about a revealed place, from the repo's own
 * place data (the Pokédex's places: the sourced gym list, PokéAPI's wild
 * encounters and areas). Nothing is written here: a place with nothing on
 * file gets no fact, and the card shows just its name and game.
 */

const BY_KEY = new Map(PLACES.map((p) => [p.key, p]));
const find = (name: string, region: string): PlaceRecord | undefined => BY_KEY.get(placeKey({ name, region }));

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const n = (x: number) => x.toLocaleString("en-US");

/** The first verified fact on file for a place, trying the building, then the town or route it's in. */
function factFor(place: PlaceRecord, home: PlaceRecord | undefined): string | null {
  // The Gym and its Leader (the quiz's gym list, each entry sourced).
  const gyms = gymsFor(place).length ? gymsFor(place) : home ? gymsFor(home) : [];
  if (gyms.length) {
    const g = gyms[0];
    const where = place.type === "Gym" ? "This Gym's Leader" : `${place.name}'s Gym Leader`;
    return `${where} is ${g.leader}${g.type ? `, ${g.type}-type` : ""}${g.badge ? ` (${g.badge})` : ""} in Pokémon ${g.game}.`;
  }
  // Wild Pokémon recorded here (PokéAPI's encounter tables).
  for (const p of [place, home]) {
    if (!p) continue;
    const rows = wildAt(p.key);
    if (!rows.length) continue;
    const species = new Set(rows.map((r) => r.id));
    const versions = new Set(rows.flatMap((r) => r.v));
    const who = p === place ? "Here" : `In ${p.name}`;
    return `${who}, ${n(species.size)} wild Pokémon species ${species.size === 1 ? "is" : "are"} recorded across ${n(versions.size)} game${versions.size === 1 ? "" : "s"}.`;
  }
  // Its areas (PokéAPI's location areas).
  const sections = place.sections.filter((s) => s.toLowerCase() !== place.name.toLowerCase());
  if (sections.length >= 2) return `${place.name} has ${n(sections.length)} areas: ${list(sections.slice(0, 4))}${sections.length > 4 ? "…" : ""}.`;
  return null;
}

/** What the learn card can say about a place (the place page link when the Pokédex has the place). */
export function learnAbout(name: string, region: string, parent?: string): GeoLearn {
  const place = find(name, region);
  const home = parent ? find(parent, region) : undefined;
  const page = place ?? home;
  return {
    href: page ? `/pokedex/places/${page.slug}` : null,
    type: place?.type ?? null,
    fact: place ? factFor(place, home) : home ? factFor(home, undefined) : null,
  };
}
