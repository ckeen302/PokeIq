/**
 * Source rows Bulbapedia shows to be wrong, fixed where they enter the build. Every fix names its evidence; the build
 * logs each row it touches in crosscheck.json ("fixes").
 */

export interface RowFix {
  games: string[];
  /** Area key (placeKey of the source's place name). */
  area: string;
  /** The rows' method. */
  method: RegExp;
  /** Only these species (all when absent). */
  species?: number[];
  /** Drop the rows, or give them these levels. */
  drop?: true;
  levels?: [number, number];
  why: string;
  source: string;
}

const HEADBUTT_TREE = "https://bulbapedia.bulbagarden.net/wiki/Headbutt_tree";

/** Forms a Pokémon has only in its battle: it is caught in its usual form (Tower summit's Eternamax Eternatus). */
export const BATTLE_ONLY_FORMS = new Set(["eternatus-eternamax"]);

export const ROW_FIXES: RowFix[] = [
  ...["route 45", "route 46"].map(
    (area): RowFix => ({
      games: ["gold-silver", "crystal"],
      area,
      method: /^Headbutt/,
      drop: true,
      why: "PokéAPI (and Serebii) give the Mountain group's Headbutt table here, but Bulbapedia's Headbutt tree page notes \"Route 45 and 46 lack headbuttable trees altogether\" in Gold, Silver and Crystal (the routes' own tables have no Headbutt rows)",
      source: HEADBUTT_TREE,
    }),
  ),
  {
    games: ["sword-shield"],
    area: "honeycalm island",
    method: /^Static$/,
    species: [416],
    drop: true,
    why: "Bulbapedia's Honeycalm Island page: \"A Dynamax Vespiquen is faced in a Max Raid Battle here as part of the story after shaking the big tree in the middle of the island. It cannot be caught.\"",
    source: "https://bulbapedia.bulbagarden.net/wiki/Honeycalm_Island",
  },
  {
    games: ["sword-shield"],
    area: "energy plant",
    method: /^Static$/,
    species: [888, 889, 890],
    drop: true,
    why: "PokéAPI and Serebii file Eternatus, and the Zacian and Zamazenta that fight beside the player against it, at the Energy Plant; all three are caught at the Tower summit on top of it (Bulbapedia's Eternatus, Zacian and Zamazenta pages: Tower Summit, Only one; the Tower summit page lists them, the Energy Plant page doesn't)",
    source: "https://bulbapedia.bulbagarden.net/wiki/Tower_summit",
  },
  {
    games: ["sword-shield"],
    area: "freezington",
    method: /^Static$/,
    species: [896, 897, 898],
    drop: true,
    why: "Bulbapedia's Freezington page: \"With the exception of Cosmog, none of the Pokémon listed here can be obtained\" (Calyrex, Glastrier and Spectrier are battled there and caught at the Crown Shrine, whose page lists them)",
    source: "https://bulbapedia.bulbagarden.net/wiki/Freezington",
  },
  {
    games: ["sword-shield"],
    area: "slumbering weald",
    method: /^Static$/,
    species: [888, 889],
    drop: true,
    why: "the Zacian or Zamazenta met in the Slumbering Weald is a scripted battle: \"None of these Pokémon can be caught, as the player has no Poké Balls at this stage of the game\" (Bulbapedia's Slumbering Weald page); Zacian's and Zamazenta's own pages give the Tower summit (Only one) as where each is caught",
    source: "https://bulbapedia.bulbagarden.net/wiki/Slumbering_Weald",
  },
  {
    games: ["gold-silver", "crystal"],
    area: "route 45",
    method: /^(Good|Super) Rod$/,
    levels: [10, 10],
    why: "PokéAPI gives the usual Good Rod Lv 20 and Super Rod Lv 40; Bulbapedia's Route 45 page: \"In Generation II only, fishing on this route results in level 10 Pokémon for all fishing rods\" (its table: Lv. 10 for every rod)",
    source: "https://bulbapedia.bulbagarden.net/wiki/Johto_Route_45",
  },
];

/**
 * Generation VII: PokéAPI files every ambush encounter (rustling grass, shadows, rustling trees and bushes, dirt and
 * sand clouds, water splashes) under its "bubbling-spots" method, i.e. as fishing at a bubbling spot. Bulbapedia's
 * table names the real one (its "Fish" rows under "Fishing at a bubbling spot" are the real fishing ones).
 */
export const AMBUSH: Record<string, string> = {
  "rustling grass": "Rustling grass",
  shadow: "Flying Pokémon's shadow",
  "rustling tree": "Rustling tree",
  "rustling bush": "Rustling bush",
  "dirt cloud": "Dirt cloud",
  "sand cloud": "Sand cloud",
  "water splashes": "Water splashes",
};

/**
 * Rows a source files under a place of its own that are really met at several places: copied to every area whose
 * Bulbapedia page has the named section, with the condition added.
 */
export interface Spread {
  game: string;
  /** The source's place key. */
  from: string;
  /** The section of an area's Bulbapedia page that lists them. */
  section: RegExp;
  cond: string;
  why: string;
  source: string;
}
export const SPREAD: Spread[] = [
  {
    game: "sword-shield",
    from: "random caves across the isle of armor",
    section: /^=+\s*\[\[In-game trade#The Isle of Armor\|Regina's Pokémon\]\]\s*=+\s*$/m,
    cond: "Regina: she moves to one of 15 places each day and after each trade",
    why: "PokéAPI files Regina's trades under a place of its own; Bulbapedia's In-game trade page: \"After trading with her, she will randomly relocate elsewhere on the Isle of Armor … Regina relocates daily\", and each of the 15 places she appears at lists her trades in a \"Regina's Pokémon\" section",
    source: "https://bulbapedia.bulbagarden.net/wiki/In-game_trade",
  },
];

/** Conditions a row's table leaves out and its page's text gives: per game, area key, species and kind. */
export const NOTES: { game: string; area: string; species: number; kind: string; cond: string; source: string }[] = [
  { game: "brilliant-diamond-shining-pearl", area: "floaroma town", species: 151, kind: "gift", cond: "With save data from Pokémon: Let's Go, Pikachu! or Let's Go, Eevee!", source: "https://bulbapedia.bulbagarden.net/wiki/Floaroma_Town" },
  { game: "brilliant-diamond-shining-pearl", area: "floaroma town", species: 385, kind: "gift", cond: "With save data from Pokémon Sword or Shield", source: "https://bulbapedia.bulbagarden.net/wiki/Floaroma_Town" },
];

/**
 * Bosses the walkthrough fights on arrival at a place, before its Pokémon (its heading comes first, then the battle,
 * and the place is explored in the next part): the boss goes before the area's step.
 */
/**
 * Areas the walkthrough's headings reach too early, moved straight after another area: Scarlet/Violet's Part 1 opens
 * with a "South Province (Area One)" heading that holds Cabo Poco, where the game begins, but the player only roams
 * Area One after Poco Path and Inlet Grotto (Part 2).
 */
export const AREA_AFTER: { game: string; area: string; after: string; why: string; source: string }[] = [
  {
    game: "scarlet-violet",
    area: "south-province-area-one",
    after: "inlet-grotto",
    why: "the walkthrough's \"South Province (Area One)\" heading opens Part 1 with Cabo Poco inside it; Part 2 goes Poco Path, Inlet Grotto, the Poco Path Lighthouse, then the road through Area One to Los Platos and Mesagoza",
    source: "https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Scarlet_and_Violet/Part_2",
  },
];

export const BOSS_BEFORE: { game: string; boss: string; area: string; why: string; source: string }[] = [
  {
    game: "sun-moon",
    boss: "Kahuna Hapu",
    area: "vast-poni-canyon",
    why: "the walkthrough's Part 22 ends at Vast Poni Canyon's entrance with the Poni Grand Trial against Hapu; the canyon (its wild Pokémon and Totem Kommo-o's trial) is Part 23",
    source: "https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Sun_and_Moon/Part_22",
  },
];

/**
 * One-time encounters Bulbapedia gives only in a page's "Special encounters" section (a {{Pokémon}} box and its text,
 * no table row), that no source has anywhere in the game: added as statics, with the text's condition.
 */
export const STATICS: { game: string; area: string; species: number; levels: [number, number]; versions?: string[]; cond: string; source: string }[] = [
  { game: "diamond-pearl", area: "turnback cave", species: 487, levels: [70, 70], cond: "On the first visit", source: "https://bulbapedia.bulbagarden.net/wiki/Turnback_Cave" },
  { game: "black-white", area: "desert resort", species: 555, levels: [35, 35], cond: "Five Darmanitan statues: use a RageCandyBar to battle one", source: "https://bulbapedia.bulbagarden.net/wiki/Desert_Resort" },
  ...["digletts tunnel", "wela volcano park"].map((area) => ({ game: "sun-moon", area, species: 793, levels: [55, 55] as [number, number], cond: "During the first Ultra Beast mission; one Nihilego, here or at " + (area === "wela volcano park" ? "Diglett's Tunnel" : "Wela Volcano Park"), source: "https://bulbapedia.bulbagarden.net/wiki/" + (area === "wela volcano park" ? "Wela_Volcano_Park" : "Diglett%27s_Tunnel") })),
  { game: "sun-moon", area: "melemele meadow", species: 794, levels: [65, 65], versions: ["sun"], cond: "During the second Ultra Beast mission (two Buzzwole)", source: "https://bulbapedia.bulbagarden.net/wiki/Melemele_Meadow" },
  ...["lush jungle", "memorial hill"].map((area) => ({ game: "sun-moon", area, species: 796, levels: [65, 65] as [number, number], cond: "During the third Ultra Beast mission; one Xurkitree here and one at " + (area === "lush jungle" ? "Memorial Hill" : "Lush Jungle"), source: "https://bulbapedia.bulbagarden.net/wiki/" + (area === "lush jungle" ? "Lush_Jungle" : "Memorial_Hill") })),
  { game: "sun-moon", area: "resolution cave", species: 799, levels: [70, 70], cond: "During the fifth Ultra Beast mission", source: "https://bulbapedia.bulbagarden.net/wiki/Resolution_Cave" },
  { game: "sun-moon", area: "ten carat hill", species: 800, levels: [75, 75], cond: "After completing all of the Ultra Beast missions", source: "https://bulbapedia.bulbagarden.net/wiki/Ten_Carat_Hill" },
];
