/**
 * Client-safe Pokémon constants and formatters. Kept apart from pokedex.ts,
 * which imports the full 1 MB snapshot and must never reach a client bundle.
 */

export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

export const STAT_LABELS: Record<StatKey, string> = {
  hp: "HP",
  atk: "Attack",
  def: "Defense",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

export const GENERATION_REGIONS: Record<number, string> = {
  1: "Kanto",
  2: "Johto",
  3: "Hoenn",
  4: "Sinnoh",
  5: "Unova",
  6: "Kalos",
  7: "Alola",
  8: "Galar",
  9: "Paldea",
};

export function formatHeight(dm: number): string {
  return `${(dm / 10).toFixed(1)} m`;
}

export function formatWeight(hg: number): string {
  return `${(hg / 10).toFixed(1)} kg`;
}

export function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
