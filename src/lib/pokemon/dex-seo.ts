import { SITE_URL } from "@/lib/site";
import { capitalize, defensiveProfile } from "./type-matrix";
import type { Pokemon } from "./pokedex";

/** SEO text for a Pokédex entry, generated only from the species' own data. */

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Types that hit this Pokémon for more than normal damage, strongest first. */
export function weaknessesOf(p: Pick<Pokemon, "types">): { type: string; multiplier: number }[] {
  return [...defensiveProfile(p.types)]
    .filter(([, m]) => m > 1)
    .map(([type, multiplier]) => ({ type: capitalize(type), multiplier }))
    .sort((a, b) => b.multiplier - a.multiplier || a.type.localeCompare(b.type));
}

export function dexTitle(p: Pick<Pokemon, "name">): string {
  return `${p.name}: Weaknesses, Stats, Abilities & Moves`;
}

export function dexDescription(p: Pokemon): string {
  const weak = weaknessesOf(p).map((w) => w.type);
  const types = p.types.map(capitalize).join("/");
  return `${p.name} (#${p.id}) is a ${types}-type Pokémon with a base stat total of ${p.bst}. ${
    weak.length ? `Weak to ${list(weak)}. ` : ""
  }Stats, abilities, moves and evolution.`;
}

export function dexSummary(p: Pokemon): string {
  const types = p.types.map(capitalize);
  const weak = weaknessesOf(p).map((w) => `${w.type}${w.multiplier > 2 ? " (4×)" : ""}`);
  const abilities = p.abilities.filter((a) => !a.hidden).map((a) => a.name);
  const hidden = p.abilities.filter((a) => a.hidden).map((a) => a.name);
  return (
    `${p.name} is a ${types.join("/")}-type ${p.genus} introduced in Generation ${p.gen}, ` +
    `number ${p.id} in the National Pokédex. It has a base stat total of ${p.bst} ` +
    `(HP ${p.stats.hp}, Attack ${p.stats.atk}, Defense ${p.stats.def}, Sp. Atk ${p.stats.spa}, Sp. Def ${p.stats.spd}, Speed ${p.stats.spe}). ` +
    (weak.length ? `It is weak to ${list(weak)} moves. ` : "It has no type weaknesses. ") +
    (abilities.length ? `Its abilities are ${list(abilities)}${hidden.length ? `, with ${list(hidden)} as a hidden ability` : ""}.` : "")
  );
}

export function dexBreadcrumbs(p: Pick<Pokemon, "name" | "slug">) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "PokéIQ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Pokédex", item: `${SITE_URL}/pokedex` },
      { "@type": "ListItem", position: 3, name: p.name, item: `${SITE_URL}/pokemon/${p.slug}` },
    ],
  };
}
