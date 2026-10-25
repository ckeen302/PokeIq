import { Dex } from "@pkmn/dex";

export type NatureStat = "atk" | "def" | "spa" | "spd" | "spe";

export const NATURE_STATS: { key: NatureStat; label: string; flavor: string }[] = [
  { key: "atk", label: "Attack", flavor: "Spicy" },
  { key: "def", label: "Defense", flavor: "Sour" },
  { key: "spa", label: "Sp. Atk", flavor: "Dry" },
  { key: "spd", label: "Sp. Def", flavor: "Bitter" },
  { key: "spe", label: "Speed", flavor: "Sweet" },
];

export interface NatureRow {
  name: string;
  plus: NatureStat | null;
  minus: NatureStat | null;
  /** Flavour of the boosted stat (liked) and of the lowered stat (disliked); null for neutral natures. */
  likes: string | null;
  dislikes: string | null;
}

const flavorOf = (s: NatureStat | null) => (s ? NATURE_STATS.find((x) => x.key === s)!.flavor : null);

/** All 25 natures, from the same data the battle engine uses. */
export function natureRows(): NatureRow[] {
  return Dex.natures
    .all()
    .map((n) => {
      const plus = (n.plus as NatureStat | undefined) ?? null;
      const minus = (n.minus as NatureStat | undefined) ?? null;
      return { name: n.name, plus, minus, likes: flavorOf(plus), dislikes: flavorOf(minus) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
