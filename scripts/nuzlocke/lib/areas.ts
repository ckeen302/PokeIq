/**
 * Place names: one key per named location, so PokéAPI's, Serebii's and Bulbapedia's spellings of a place meet.
 */

const REGIONS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "hisui", "paldea"];

/** Loose comparison key of a place name: case, accents, punctuation, "Mount"/"Mt.", a leading region and "Sea Route". */
export function placeKey(name: string): string {
  let k = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bmount\b/g, "mt")
    .replace(/\bpokemon\b/g, "pokemon")
    .replace(/^the /, "");
  const first = k.split(" ")[0];
  if (REGIONS.includes(first) && k.split(" ").length > 1) k = k.slice(first.length + 1);
  k = k.replace(/^sea (route \d+)$/, "$1").replace(/^road (\d+)$/, "route $1");
  return k;
}

/** URL-safe stable id of an area name ("Mt. Moon" -> "mt-moon", "Route 1" -> "route-1"). */
export function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Pokemon" -> "Pokémon" in English names PokéAPI spells without the accent. */
export const accent = (s: string) => s.replace(/\bPokemon\b/g, "Pokémon").replace(/\bPokeRadar\b/g, "Poké Radar");

/** A PokéAPI location's English name as a place name: no disambiguating region prefix, "Sea Route 19" -> "Route 19". */
export function cleanPlace(name: string): string {
  let n = accent(name.trim());
  const m = n.match(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Hisui|Paldea) (.+)$/);
  if (m) n = m[2];
  return n.replace(/^Sea (Route \d+)$/, "$1");
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/**
 * The part of a place a PokéAPI location-area is ("1F", "South, towards Viridian City", "Prize Corner"), or undefined
 * when the area is the whole place.
 */
export function subArea(place: string, areaEnName: string | undefined, areaSlug: string, locSlug: string): string | undefined {
  const pk = placeKey(place);
  const sameAsPlace = (s: string) => {
    const k = placeKey(s);
    return !k || k === pk || k === "area" || /^route \d+$/.test(k) && k === pk;
  };
  if (areaEnName) {
    let s = accent(areaEnName.trim());
    const paren = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (paren) {
      const [, before, inside] = paren;
      // "Cinnabar Lab (Cinnabar Island)", "Pokemon Center (Road 4)": the parenthesis names the place itself.
      if (sameAsPlace(inside) || placeKey(inside) === placeKey(place.replace(/^Route/, "Road"))) s = before;
      // "Mount Moon (1F)", "Road 2 (south, towards Viridian City)": the parenthesis is the part.
      else if (sameAsPlace(before) || placeKey(before).startsWith(pk)) s = inside;
    }
    // "Celadon City Prize Corner" -> "Prize Corner"; "Mount Ember Summit" -> "Summit".
    const words = s.split(/\s+/);
    for (let n = words.length - 1; n >= 1; n--) {
      if (placeKey(words.slice(0, n).join(" ")) === pk) {
        s = words.slice(n).join(" ");
        break;
      }
    }
    if (!sameAsPlace(s)) return cap(s);
    return undefined;
  }
  const rest = areaSlug.replace(locSlug, "").replace(/^-+|-+$/g, "").replace(/(^|-)area$/, "");
  if (!rest) return undefined;
  return cap(rest.replace(/-/g, " ").replace(/\b(\d+f|b\d+f)\b/gi, (x) => x.toUpperCase()));
}
