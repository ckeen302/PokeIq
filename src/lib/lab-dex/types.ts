/**
 * The Professor's Lab (/lab/pokedex): what the page sends the client about
 * every Pokémon on the wheel (all species and their Mega, regional,
 * Gigantamax and Eternamax forms), as compact rows, and the shape the client
 * works with. Long text (Pokédex entries, abilities, the evolution line) is
 * loaded per Pokémon from /api/lab-dex/<id> when it's picked.
 */

/** hp, atk, def, spa, spd, spe. */
export type Stats6 = [number, number, number, number, number, number];

export type FormKind = "" | "mega" | "regional" | "gmax" | "eternamax";

/**
 * One Pokémon as a row of values (no repeated field names):
 * [art id (species number, or the form's PokéAPI id), slug of its Pokédex page (the species'),
 *  name, genus, types (space separated), gen, hp, atk, def, spa, spd, spe,
 *  height (dm), weight (hg, -1 unknown), flags (1 legendary, 2 mythical, 4 fully evolved, 8 form),
 *  species number, evolution chain, evolves from (0 none), form kind,
 *  HOME render box x, y, w, h (of a 512 px render)]
 */
export type LabRow = [
  number, string, string, string, string, number,
  number, number, number, number, number, number,
  number, number, number, number, number, number, FormKind,
  number, number, number, number,
];

export interface LabMon {
  /** The art / figure id: the species number, or 10001+ for a form. Also the `pick` in the URL. */
  id: number;
  /** The species' Pokédex page (/pokemon/<slug>). */
  slug: string;
  name: string;
  genus: string;
  types: string[];
  gen: number;
  stats: Stats6;
  bst: number;
  /** Metres. */
  heightM: number;
  /** Kilograms, null when unknown (Gigantamax). */
  weightKg: number | null;
  legendary: boolean;
  mythical: boolean;
  fullyEvolved: boolean;
  isForm: boolean;
  formKind: FormKind;
  species: number;
  chain: number;
  evolvesFrom: number;
  /** The HOME render's visible box [x, y, w, h, image size]. */
  box: [number, number, number, number, number];
}

export function fromRow(r: LabRow): LabMon {
  const [id, slug, name, genus, types, gen, hp, atk, def, spa, spd, spe, height, weight, flags, species, chain, evolvesFrom, formKind, bx, by, bw, bh] = r;
  return {
    id,
    slug,
    name,
    genus,
    types: types.split(" "),
    gen,
    stats: [hp, atk, def, spa, spd, spe],
    bst: hp + atk + def + spa + spd + spe,
    heightM: height / 10,
    weightKg: weight < 0 ? null : weight / 10,
    legendary: (flags & 1) !== 0,
    mythical: (flags & 2) !== 0,
    fullyEvolved: (flags & 4) !== 0,
    isForm: (flags & 8) !== 0,
    formKind,
    species,
    chain,
    evolvesFrom,
    box: [bx, by, bw, bh, 512],
  };
}

/** One step of an evolution line (the details' tree). */
export interface LabEvoNode {
  id: number;
  name: string;
  /** How it evolves from its parent ("Level 36", "Use Water Stone"). */
  conditions: string[];
  children: LabEvoNode[];
}

/** What /api/lab-dex/<id> sends: the Pokémon's longer text. */
export interface LabDetails {
  id: number;
  /** A Pokédex entry and the games it's from. */
  entry: { text: string; games: string[] } | null;
  abilities: { name: string; hidden: boolean; effect: string }[];
  /** The evolution line it belongs to (null when it doesn't evolve). */
  evolution: LabEvoNode | null;
}
