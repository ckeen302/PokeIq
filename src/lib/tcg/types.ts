/** The parts of the Pokémon TCG API (api.pokemontcg.io/v2) schema PokéIQ reads. Every field may be missing. */

export interface TcgSet {
  id: string;
  name: string;
  series: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
  /** "YYYY/MM/DD" */
  releaseDate?: string;
  images?: { symbol?: string; logo?: string };
}

export interface TcgPriceRow {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
}

export interface TcgAttack {
  name: string;
  cost?: string[];
  damage?: string;
  text?: string;
}

export interface TcgAbility {
  name: string;
  text?: string;
  type?: string;
}

export interface TcgCard {
  id: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  abilities?: TcgAbility[];
  attacks?: TcgAttack[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  rules?: string[];
  set?: TcgSet;
  number?: string;
  artist?: string;
  rarity?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  regulationMark?: string;
  images?: { small?: string; large?: string };
  tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, TcgPriceRow | undefined> };
  cardmarket?: { url?: string; updatedAt?: string; prices?: Record<string, number | null | undefined> };
}

/** What a gallery tile needs: small enough to hand to the browser for a whole set. */
export interface CardTile {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  /** Energy types, or the supertype (Trainer / Energy) for non-Pokémon cards. */
  kinds: string[];
  image: string | null;
  setName: string | null;
  releaseDate: string | null;
  price: { value: number; currency: "USD" | "EUR"; label: string } | null;
}
