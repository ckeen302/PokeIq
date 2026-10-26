/** Games the Trainers tab covers, in release order. Client safe. */
export interface TrainerGame {
  key: string;
  name: string;
  short: string;
  gen: number;
  /** Version keys (encounter-types VERSIONS) this file covers. */
  versions: string[];
  regions: string[];
  /** pret decompilation the data was imported from. */
  repo: string;
  /** Accent colour for game chips. */
  color: string;
}

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
];

const BY_KEY = new Map(TRAINER_GAMES.map((g) => [g.key, g]));
export const trainerGame = (key: string) => BY_KEY.get(key);
export const TRAINER_REGIONS = [...new Set(TRAINER_GAMES.flatMap((g) => g.regions))];
