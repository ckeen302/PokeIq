/** Games the Trainers tab covers, in release order. Client safe. */
export interface TrainerGame {
  key: string;
  name: string;
  short: string;
  gen: number;
  /** Version keys (encounter-types VERSIONS) this file covers. */
  versions: string[];
  regions: string[];
  /** pret decompilation the data was imported from ("Bulbapedia" for the wiki-imported games). */
  repo: string;
  /** Accent colour for game chips. */
  color: string;
}

const WIKI = "Bulbapedia";

export const TRAINER_GAMES: TrainerGame[] = [
  { key: "red-blue", name: "Red & Blue", short: "RB", gen: 1, versions: ["red", "blue"], regions: ["Kanto"], repo: "pret/pokered", color: "#c0392b" },
  { key: "yellow", name: "Yellow", short: "Y", gen: 1, versions: ["yellow"], regions: ["Kanto"], repo: "pret/pokeyellow", color: "#d4b000" },
  { key: "gold-silver", name: "Gold & Silver", short: "GS", gen: 2, versions: ["gold", "silver"], regions: ["Johto", "Kanto"], repo: "pret/pokegold", color: "#b8912a" },
  { key: "crystal", name: "Crystal", short: "C", gen: 2, versions: ["crystal"], regions: ["Johto", "Kanto"], repo: "pret/pokecrystal", color: "#3fa7c9" },
  { key: "ruby-sapphire", name: "Ruby & Sapphire", short: "RS", gen: 3, versions: ["ruby", "sapphire"], regions: ["Hoenn"], repo: "pret/pokeruby", color: "#b01e3e" },
  { key: "emerald", name: "Emerald", short: "E", gen: 3, versions: ["emerald"], regions: ["Hoenn"], repo: "pret/pokeemerald", color: "#1f9d55" },
  { key: "firered-leafgreen", name: "FireRed & LeafGreen", short: "FRLG", gen: 3, versions: ["firered", "leafgreen"], regions: ["Kanto", "Sevii Islands"], repo: "pret/pokefirered", color: "#e8541e" },
  { key: "diamond-pearl", name: "Diamond & Pearl", short: "DP", gen: 4, versions: ["diamond", "pearl"], regions: ["Sinnoh"], repo: "pret/pokediamond", color: "#5a7fc0" },
  { key: "platinum", name: "Platinum", short: "Pt", gen: 4, versions: ["platinum"], regions: ["Sinnoh"], repo: "pret/pokeplatinum", color: "#7d7f8c" },
  { key: "heartgold-soulsilver", name: "HeartGold & SoulSilver", short: "HGSS", gen: 4, versions: ["heartgold", "soulsilver"], regions: ["Johto", "Kanto"], repo: "pret/pokeheartgold", color: "#c9a227" },
  // Generation V–IX: imported from Bulbapedia's location pages (no complete decompilations exist).
  { key: "black-white", name: "Black & White", short: "BW", gen: 5, versions: ["black", "white"], regions: ["Unova"], repo: WIKI, color: "#444444" },
  { key: "black-2-white-2", name: "Black 2 & White 2", short: "B2W2", gen: 5, versions: ["black-2", "white-2"], regions: ["Unova"], repo: WIKI, color: "#5b6b7a" },
  { key: "x-y", name: "X & Y", short: "XY", gen: 6, versions: ["x", "y"], regions: ["Kalos"], repo: WIKI, color: "#2563a8" },
  { key: "omega-ruby-alpha-sapphire", name: "Omega Ruby & Alpha Sapphire", short: "ORAS", gen: 6, versions: ["omega-ruby", "alpha-sapphire"], regions: ["Hoenn"], repo: WIKI, color: "#a21d2e" },
  { key: "sun-moon", name: "Sun & Moon", short: "SM", gen: 7, versions: ["sun", "moon"], regions: ["Alola"], repo: WIKI, color: "#f08a1c" },
  { key: "ultra-sun-ultra-moon", name: "Ultra Sun & Ultra Moon", short: "USUM", gen: 7, versions: ["ultra-sun", "ultra-moon"], regions: ["Alola"], repo: WIKI, color: "#3a3f9e" },
  { key: "lets-go-pikachu-eevee", name: "Let's Go, Pikachu! & Let's Go, Eevee!", short: "LGPE", gen: 7, versions: ["lets-go-pikachu", "lets-go-eevee"], regions: ["Kanto"], repo: WIKI, color: "#d9a400" },
  { key: "sword-shield", name: "Sword & Shield", short: "SwSh", gen: 8, versions: ["sword", "shield"], regions: ["Galar", "Isle of Armor", "Crown Tundra"], repo: WIKI, color: "#2fa8d9" },
  { key: "brilliant-diamond-shining-pearl", name: "Brilliant Diamond & Shining Pearl", short: "BDSP", gen: 8, versions: ["brilliant-diamond", "shining-pearl"], regions: ["Sinnoh"], repo: WIKI, color: "#5b8fd6" },
  { key: "scarlet-violet", name: "Scarlet & Violet", short: "SV", gen: 9, versions: ["scarlet", "violet"], regions: ["Paldea", "Kitakami", "Blueberry Academy"], repo: WIKI, color: "#b0366e" },
];

/** Source link for a game's data: the pret repo, or Bulbapedia for Gen V–IX. */
export const sourceUrl = (g: TrainerGame) => (g.repo === WIKI ? "https://bulbapedia.bulbagarden.net/" : `https://github.com/${g.repo}`);
export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

const BY_KEY = new Map(TRAINER_GAMES.map((g) => [g.key, g]));
export const trainerGame = (key: string) => BY_KEY.get(key);
export const TRAINER_REGIONS = [...new Set(TRAINER_GAMES.flatMap((g) => g.regions))];
