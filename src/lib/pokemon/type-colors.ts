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

/** Light types need dark text for contrast. */
export function typeTextColor(type: string): string {
  return ["electric", "ice", "ground", "steel", "normal", "bug", "rock", "fairy", "grass"].includes(type) ? "#111827" : "#ffffff";
}
