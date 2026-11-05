import "server-only";
import { Dex } from "@pkmn/dex";
import type { Stats } from "./types";

/**
 * The base stats of a Mega, Gigantamax, regional or Eternamax form on
 * /pokedex/sizes, from @pkmn/dex (Pokémon Showdown's data, which the
 * battles use too). Every form is looked up by its own forme, never its
 * species: a form @pkmn/dex doesn't have (or files under another species)
 * gets no stats, and the Sizes orders leave it out rather than borrow the
 * default form's numbers.
 */

/** PokéAPI slugs that @pkmn/dex spells differently. */
const DEX_NAME: Record<string, string> = {
  "darmanitan-galar-standard": "Darmanitan-Galar",
  "tauros-paldea-combat-breed": "Tauros-Paldea-Combat",
  "tauros-paldea-blaze-breed": "Tauros-Paldea-Blaze",
  "tauros-paldea-aqua-breed": "Tauros-Paldea-Aqua",
};

/** A form's own base stats, or null when @pkmn/dex has no such forme of that species. */
export function formStats(slug: string, species: number): Stats | null {
  const s = Dex.species.get(DEX_NAME[slug] ?? slug);
  // Only that species' own alternate forme: an unknown name must not fall back to the base species.
  if (!s.exists || s.num !== species || !s.forme) return null;
  const b = s.baseStats;
  return [b.hp, b.atk, b.def, b.spa, b.spd, b.spe];
}
