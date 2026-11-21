import type { GeoAnswer, GeoRegionInfo } from "@/lib/geo-types";

/**
 * Map, place, region and game names in the page's language for PokéGuessr duels and parties. The page (a server
 * component) sends them on a page in another language only (src/lib/server/guessr-duel-names.ts); English pages get
 * none and show the names exactly as the server wrote them. A name with no official translation stays English.
 * They are only ever shown for a round already revealed (or the map the room plays on), never before.
 */
export interface GuessrNames {
  /** Map id → its name ("world", "kanto", "theme-gyms"). */
  maps: Record<string, string>;
  /** Places and regions, by key (the English name lowercased, letters and digits only). */
  places: Record<string, string>;
  /** Games, by key ("sword", "letsgopikachu"). */
  games: Record<string, string>;
  /** Between two games of a pair ("Sword / Shield"). */
  gameSep: string;
}

/** The data files' key for an English name: lowercased, accents dropped, letters and digits only. */
export const nameKey = (english: string) =>
  english
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const REGION_RE = "Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea";
/** As in the single-player game: no "Kanto " before route names. */
const clean = (s: string) => s.replace(new RegExp(`^(${REGION_RE}) (?=Route)`), "");
/** The in-game name, without the wiki's disambiguation ("Iron Ruins (Sinnoh)", "Battle Tower (Generation III)", "Victory Road (BW)"). */
const shown = (s: string) => clean(s).replace(new RegExp(` \\((${REGION_RE}|Generation [IVX]+|BW|B2W2|Jagged Pass)\\)$`), "");

const place = (english: string, names?: GuessrNames) => (names ? (names.places[nameKey(english)] ?? english) : english);

/** A map's name in the page's language. */
export const mapName = (map: Pick<GeoRegionInfo, "id" | "name">, names?: GuessrNames) => names?.maps[map.id] ?? map.name;

/** The map with its name in the page's language (what GeoMap labels it with). */
export const namedMap = (map: GeoRegionInfo, names?: GuessrNames): GeoRegionInfo => (names ? { ...map, name: mapName(map, names) } : map);

/** "Pewter Gym · Pewter City", with the region when the map doesn't say it ("…, Johto" on the world map). */
export function placeName(answer: GeoAnswer, map: GeoRegionInfo, names?: GuessrNames): string {
  const one = (s: string) => place(shown(s), names);
  const name = answer.parent ? `${one(answer.name)} · ${one(answer.parent)}` : one(answer.name);
  return answer.region && answer.region !== map.name ? `${name}, ${place(answer.region, names)}` : name;
}

/** A screenshot's game ("Sword / Shield", "Let's Go, Pikachu! / Eevee!") in the page's language. */
export function gameName(game: string, names?: GuessrNames): string {
  if (!names) return game;
  const parts = game.split(" / ");
  const out = parts.map((part, i) => {
    const k = nameKey(part);
    // "Let's Go, Pikachu! / Eevee!": the second half carries the first's "Let's Go".
    const pair = i > 0 && nameKey(parts[0]).startsWith("letsgo") && !k.startsWith("letsgo") ? `letsgo${k}` : k;
    return names.games[k] ?? names.games[pair] ?? part;
  });
  return out.join(names.gameSep);
}
