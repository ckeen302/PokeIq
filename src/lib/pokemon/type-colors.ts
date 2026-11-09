/** Canonical type colours (hex) used across the Pokédex UI. */
export const TYPE_COLORS: Record<string, string> = {
  normal: "#a8a77a",
  fire: "#ee8130",
  water: "#6390f0",
  electric: "#f7d02c",
  grass: "#7ac74c",
  ice: "#96d9d6",
  fighting: "#c22e28",
  poison: "#a33ea1",
  ground: "#e2bf65",
  flying: "#a98ff3",
  psychic: "#f95587",
  bug: "#a6b91a",
  rock: "#b6a136",
  ghost: "#735797",
  dragon: "#6f35fc",
  dark: "#705746",
  steel: "#b7b7ce",
  fairy: "#d685ad",
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#888";
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The label colour with more contrast on the type's colour: white, or near-black on the lighter types. */
export function typeTextColor(type: string): string {
  const l = luminance(typeColor(type).length === 7 ? typeColor(type) : "#888888");
  const white = 1.05 / (l + 0.05);
  const dark = (l + 0.05) / (luminance("#111827") + 0.05);
  return white >= dark ? "#ffffff" : "#111827";
}
