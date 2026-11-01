/**
 * Anime rounds for "Whose Team Is This?". Each list is copied from one
 * section of the trainer's page on the Pokémon Wiki (Fandom), in the order
 * the page lists it, and that section is named in `appearance`. Species are
 * the page's final forms, except where the page's own heading names the form
 * the Pokémon had in that series (Ash's Aipom in Advanced Generation).
 * Pages were read with the MediaWiki API (action=parse, wikitext). Bulbapedia
 * (the `source` link) blocked scripted reads at the time.
 */
import pokedex from "../../src/data/pokedex.json";
import type { TeamEntry, TeamMon } from "../../src/lib/whose-team/types";

const BY_NAME = new Map((pokedex as { id: number; name: string }[]).map((p) => [p.name, p.id]));
const team = (...names: string[]): TeamMon[] =>
  names.map((name) => {
    const dex = BY_NAME.get(name);
    if (!dex) throw new Error(`Unknown species ${name}`);
    return { species: name, dex };
  });

const FANDOM = (title: string) => `https://pokemon.fandom.com/wiki/${encodeURI(title.replace(/ /g, "_"))}`;
const BULBA = (title: string) => `https://bulbapedia.bulbagarden.net/wiki/${encodeURI(title.replace(/ /g, "_"))}`;

type Anime = Omit<TeamEntry, "kind">;

const ash = (id: string, gen: number, series: string, section: string, page: string, members: string[], ace = "Pikachu"): Anime => ({
  id: `anime:ash:${id}`,
  trainer: "Ash",
  gen,
  series,
  appearance: `Anime: ${series} — ${section}`,
  team: team(...members),
  ace,
  source: BULBA("Ash Ketchum"),
  data: `${FANDOM(page)} (${section.replace(/^Ash's /, "")})`,
});

export const ANIME_TEAMS: Anime[] = [
  ash("johto", 2, "Pokémon: Gold and Silver (Johto)", "Ash's Pokémon on hand at the end of the series", "Ash Ketchum/Gold and Silver", ["Pikachu", "Bayleef", "Quilava", "Totodile", "Noctowl", "Donphan"]),
  ash("hoenn", 3, "Pokémon: Advanced Generation (Hoenn and the Battle Frontier)", "Ash's Pokémon on hand at the end of the series", "Ash Ketchum/Ruby and Sapphire", ["Pikachu", "Donphan", "Swellow", "Sceptile", "Corphish", "Aipom"]),
  ash("sinnoh", 4, "Pokémon: Diamond and Pearl (Sinnoh)", "Ash's Pokémon on hand at the end of the series", "Ash Ketchum/Diamond and Pearl", ["Pikachu", "Staraptor", "Torterra", "Infernape", "Buizel", "Gible"]),
  ash("unova", 5, "Pokémon: Black & White (Unova)", "Ash's Pokémon on hand at the end of the series", "Ash Ketchum/Black & White", ["Pikachu", "Charizard", "Oshawott", "Pignite", "Snivy", "Scraggy"]),
  ash("kalos", 6, "Pokémon the Series: XY and XYZ (Kalos)", "Ash's Kalos Pokémon (on hand, plus Greninja and Goodra, released)", "Ash Ketchum/XY and XYZ", ["Pikachu", "Talonflame", "Hawlucha", "Noivern", "Greninja", "Goodra"]),
  ash("alola", 7, "Pokémon the Series: Sun & Moon (Alola)", "Ash's Alola Pokémon (with Professor Kukui, plus Naganadel, released)", "Ash Ketchum/Sun & Moon", ["Pikachu", "Rowlet", "Lycanroc", "Incineroar", "Melmetal", "Naganadel"]),
  ash("journeys", 8, "Pokémon Journeys (World Coronation Series)", "Ash's Pokémon first caught in Journeys", "Ash Ketchum/Journeys", ["Pikachu", "Dragonite", "Gengar", "Lucario", "Sirfetch’d", "Dracovish"]),
  {
    id: "anime:brock:dp",
    trainer: "Brock",
    gen: 4,
    series: "Pokémon (Kanto to Sinnoh)",
    appearance: "Anime: Brock's Pokémon in rotation",
    team: team("Steelix", "Forretress", "Ludicolo", "Marshtomp", "Croagunk", "Blissey"),
    ace: "Steelix",
    source: BULBA("Brock (anime)"),
    data: `${FANDOM("Brock (anime)")} (In rotation)`,
  },
  {
    id: "anime:misty:rotation",
    trainer: "Misty",
    gen: 1,
    series: "Pokémon (Kanto and later appearances)",
    appearance: "Anime: Misty's Pokémon in rotation",
    team: team("Staryu", "Starmie", "Psyduck", "Politoed", "Gyarados", "Azurill", "Clauncher"),
    ace: "Starmie",
    source: BULBA("Misty (anime)"),
    data: `${FANDOM("Misty (anime)")} (In rotation)`,
  },
  {
    id: "anime:gary:journeys",
    trainer: "Gary",
    gen: 8,
    series: "Pokémon Journeys",
    appearance: "Anime: Gary's Pokémon in rotation (Journeys)",
    team: team("Blastoise", "Arcanine", "Umbreon", "Electivire", "Tyranitar", "Hatterene", "Regidrago"),
    ace: "Blastoise",
    source: BULBA("Gary Oak"),
    data: `${FANDOM("Gary Oak")} (In rotation)`,
  },
  {
    id: "anime:paul:journeys",
    trainer: "Paul",
    gen: 4,
    series: "Pokémon: Diamond and Pearl and Journeys",
    appearance: "Anime: Paul's Pokémon on hand (his latest appearance)",
    team: team("Electivire", "Gyarados", "Garchomp", "Metagross"),
    ace: "Electivire",
    source: BULBA("Paul"),
    data: `${FANDOM("Paul")} (On hand)`,
  },
  {
    id: "anime:cynthia:journeys",
    trainer: "Cynthia",
    gen: 8,
    series: "Pokémon Journeys",
    appearance: "Anime: Cynthia's Pokémon on hand (as of Journeys)",
    team: team("Garchomp", "Gastrodon", "Glaceon", "Kommo-o", "Roserade", "Milotic", "Spiritomb", "Togekiss"),
    ace: "Garchomp",
    source: BULBA("Cynthia (anime)"),
    data: `${FANDOM("Cynthia (anime)")} (On hand)`,
  },
  {
    id: "anime:alain:xyz",
    trainer: "Alain",
    gen: 6,
    series: "Pokémon the Series: XY and XYZ (Kalos)",
    appearance: "Anime: Alain's Pokémon in rotation",
    team: team("Charizard", "Metagross", "Tyranitar", "Weavile", "Bisharp", "Unfezant", "Chesnaught", "Malamar"),
    ace: "Charizard",
    source: BULBA("Alain"),
    data: `${FANDOM("Alain")} (In rotation)`,
  },
  {
    id: "anime:leon:journeys",
    trainer: "Leon",
    gen: 8,
    series: "Pokémon Journeys",
    appearance: "Anime: Leon's Pokémon on hand (Journeys)",
    team: team("Charizard", "Dragapult", "Rillaboom", "Cinderace", "Inteleon", "Mr. Rime"),
    ace: "Charizard",
    source: BULBA("Leon (anime)"),
    data: `${FANDOM("Leon (anime)")} (On hand)`,
  },
  {
    id: "anime:liko:horizons",
    trainer: "Liko",
    gen: 9,
    series: "Pokémon Horizons",
    appearance: "Anime: Liko's Pokémon on hand (Horizons)",
    team: team("Meowscarada", "Hatterene", "Armarouge"),
    ace: "Meowscarada",
    source: BULBA("Liko"),
    data: `${FANDOM("Liko")} (On hand)`,
  },
  {
    id: "anime:roy:horizons",
    trainer: "Roy",
    gen: 9,
    series: "Pokémon Horizons",
    appearance: "Anime: Roy's Pokémon on hand (Horizons)",
    team: team("Skeledirge", "Kilowattrel", "Lucario"),
    ace: "Skeledirge",
    source: BULBA("Roy (Horizons)"),
    data: `${FANDOM("Roy")} (On hand)`,
  },
];
