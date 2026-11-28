import "server-only";
import { Generations, type Data, type Generation, type Specie } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import POKEDEX_DATA from "@/data/pokedex.json";
import DETAILS from "@/data/pokedex-details.json";
import SIZES_ART from "@/data/sizes-art.json";
import { TYPES } from "@/lib/pokemon/type-matrix";
import type { NuzArea, NuzGame } from "./model";
import { bossKeys, monKey, type GameView, type ViewArea, type ViewMon, type ViewStep } from "./view";
import { addOnOf, compactEncounters, dayOf, withoutPart } from "./compact";
import { COSMETIC_FORMS, FORM_ART, POKEAPI_DEFAULTS, SHOWDOWN_DEFAULTS, cosmeticArt } from "./form-art";

/**
 * A game's data made ready for the tracker's screens (lib/nuzlocke/view.ts), on the server: every Pokémon's name,
 * picture and Pokédex page from the site's Pokédex (PokéAPI's data), and its types, evolutions and the type chart from
 * Pokémon Showdown's data for the game's own generation (@pkmn/data): a Clefairy is Normal before Generation VI and
 * Fairy after, Gen 1's chart is Gen 1's. PokéAPI names forms "rattata-alola"; Showdown "Rattata-Alola" (see specieFor).
 */

interface DexRow {
  id: number;
  slug: string;
  name: string;
  gen: number;
  chain: number;
  stage: number;
}
interface FormRow {
  id: number;
  slug: string;
  name: string;
  types: string[];
}

const POKEDEX = POKEDEX_DATA as unknown as DexRow[];
const BY_ID = new Map(POKEDEX.map((p) => [p.id, p]));
const FORMS = new Map<string, FormRow & { species: number }>();
for (const [id, d] of Object.entries(DETAILS as unknown as Record<string, { forms?: FormRow[] }>)) for (const f of d.forms ?? []) FORMS.set(f.slug, { ...f, species: Number(id) });
/** Pictures the site has: its Pokémon art (made for /pokedex/sizes), and the forms the tracker added to it (form-art.ts). */
const HAS_ART = new Set([...Object.keys(SIZES_ART as Record<string, unknown>).map(Number), ...Object.values(FORM_ART), ...Object.values(SHOWDOWN_DEFAULTS).map((d) => d.art)]);

/** Real species and formes of the generation, also those no longer in its newest games ("Past"), as the calculators take them. */
const ALLOWED_NONSTANDARD = new Set(["Past", "Unobtainable"]);
function exists(d: Data): boolean {
  if (!d.exists) return false;
  if (d.kind === "Ability" && d.id === "noability") return false;
  return !("isNonstandard" in d && d.isNonstandard && !ALLOWED_NONSTANDARD.has(d.isNonstandard));
}

let gens: Generations | null = null;
export function generation(num: number): Generation {
  gens ??= new Generations(Dex, exists);
  return gens.get(num);
}

const baseByNum = new Map<number, Map<number, Specie>>();
function baseSpecie(gen: Generation, num: number): Specie | undefined {
  let map = baseByNum.get(gen.num);
  if (!map) {
    map = new Map();
    for (const s of gen.species) if (!s.forme && s.num > 0) map.set(s.num, s);
    baseByNum.set(gen.num, map);
  }
  return map.get(num);
}

/** PokéAPI form names Showdown spells another way that its own names and aliases don't reach. */
const ALIASES: Record<string, string> = {
  "raticate-totem-alola": "Raticate-Alola-Totem",
  "marowak-totem": "Marowak-Alola-Totem",
  "meowstic-female": "Meowstic-F",
  "indeedee-female": "Indeedee-F",
  "oinkologne-female": "Oinkologne-F",
  "basculegion-female": "Basculegion-F",
};

/**
 * Showdown's name for a PokéAPI form, whatever the generation (undefined: a form Showdown doesn't keep apart). The name
 * is tried as Showdown spells it ("rattata-alola" is "Rattata-Alola"), then without PokéAPI's trailing words for a form
 * Showdown treats as the default or names shorter ("darmanitan-galar-standard" is "Darmanitan-Galar",
 * "tauros-paldea-combat-breed" "Tauros-Paldea-Combat", "lycanroc-midday" "Lycanroc"); Showdown's aliases cover the
 * rest ("necrozma-dusk" is "Necrozma-Dusk-Mane"). Only a match of the same species counts.
 */
export function showdownName(species: number, form: string): string | undefined {
  if (ALIASES[form]) return ALIASES[form];
  const parts = form.split("-");
  for (let n = parts.length; n > 1; n--) {
    const s = Dex.species.get(parts.slice(0, n).join("-"));
    if (s?.exists && s.num === species) return s.name;
  }
  return undefined;
}

/**
 * Showdown's species for a PokéAPI species and form in a generation. A form the generation doesn't have (a Partner
 * Pikachu, a Gigantamax) is its species' default, whose types it shares.
 */
export function specieFor(gen: Generation, species: number, form?: string): Specie | undefined {
  const name = form ? showdownName(species, form) : undefined;
  return (name ? gen.species.get(name) : undefined) ?? baseSpecie(gen, species);
}

/** Showdown's formes back to PokéAPI's form names, for every form the site's Pokédex has. */
const POKEAPI_FORM = new Map<string, string>();
for (const [slug, f] of FORMS) {
  const name = showdownName(f.species, slug);
  // Two PokéAPI forms can be one Showdown forme (Zygarde-10%): the shorter name wins.
  if (name && (!POKEAPI_FORM.has(name) || slug.length < POKEAPI_FORM.get(name)!.length)) POKEAPI_FORM.set(name, slug);
}
for (const [slug, name] of Object.entries(ALIASES)) if (!POKEAPI_FORM.has(name)) POKEAPI_FORM.set(name, slug);

/** Showdown's short formes in PokéAPI's words: "Meowstic-F" is "meowstic-female". */
const FORME_WORDS: Record<string, string> = { F: "female", M: "male" };

/** PokéAPI's form name for a Showdown forme ("Raichu-Alola" → "raichu-alola"), or undefined for a species' default. */
export function formFor(s: Specie): string | undefined {
  if (!s.forme) return undefined;
  const known = POKEAPI_FORM.get(s.name);
  if (known) return known;
  const base = BY_ID.get(s.num)?.slug ?? s.baseSpecies.toLowerCase();
  const forme = (FORME_WORDS[s.forme] ?? s.forme).toLowerCase().replace(/['’%.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base}-${forme}`;
}

/** Regional formes as their names say them ("Alolan Rattata"). */
const REGIONAL: Record<string, string> = { Alola: "Alolan", Galar: "Galarian", Hisui: "Hisuian", Paldea: "Paldean" };

/**
 * A form's English name when the site's Pokédex has none for it: Showdown's forme put first, as the games word them
 * ("Blue-Striped Basculin", "Resolute Keldeo", "Female Meowstic"), never Showdown's own "Basculin-Blue-Striped".
 */
function formeName(s: Specie): string {
  const forme = s.forme === "F" ? "Female" : s.forme === "M" ? "Male" : (REGIONAL[s.forme] ?? s.forme);
  return `${forme} ${s.baseSpecies}`;
}

/** `art`: the form's picture id when the game data names one (NuzEncounter.art). `abilities`: for the Team Builder. */
function viewMon(gen: Generation, species: number, form: string | undefined, artId: number | undefined, abilities: boolean): ViewMon | null {
  const row = BY_ID.get(species);
  if (!row) return null;
  const f = form ? FORMS.get(form) : undefined;
  const specie = specieFor(gen, species, form);
  const cosmetic = form ? COSMETIC_FORMS[form] : undefined;
  // The form's own picture: a cosmetic form's (kept with the tracker), else the first id with a picture of the data's,
  // the Pokédex's and the tracker's own (form-art.ts); the species' only for a form that looks the same (Partner Pikachu).
  const ids = form ? [artId, f?.id, FORM_ART[form]].filter((id): id is number => !!id && HAS_ART.has(id)) : [];
  const swap = SHOWDOWN_DEFAULTS[form ?? String(species)];
  const art = swap?.art ?? (cosmetic ? cosmeticArt(form!) : (ids[0] ?? species));
  return {
    key: form ?? String(species),
    species,
    ...(form && { form }),
    name: swap?.name ?? cosmetic?.name ?? f?.name ?? (form && specie?.forme ? formeName(specie) : row.name),
    slug: row.slug,
    art,
    types: (specie?.types ?? []).map((t) => t.toLowerCase()),
    family: row.chain,
    showdown: specie?.name ?? row.name,
    ...(abilities && specie?.abilities[0] && { ability: specie.abilities[0] }),
  };
}

/**
 * Each Pokémon of the game, and everything it can evolve into up to the game's generation (`upTo`), each with its own
 * evolutions, looked up in `gen`'s Pokédex.
 */
function collectMons(gen: Generation, upTo: number, abilities: boolean, seeds: { species: number; form?: string; art?: number }[]): Record<string, ViewMon> {
  const mons: Record<string, ViewMon> = {};
  const queue = [...seeds];
  while (queue.length) {
    const { species, form, art } = queue.shift()!;
    const key = form ?? String(species);
    if (mons[key]) continue;
    const mon = viewMon(gen, species, form, art, abilities);
    if (!mon) continue;
    mons[key] = mon;
    // A cosmetic form evolves into the same sea's, the same flower's (Showdown keeps one evolution for all of them).
    const cosmetic = form ? COSMETIC_FORMS[form] : undefined;
    if (cosmetic) {
      if (cosmetic.evolves && COSMETIC_FORMS[cosmetic.evolves].species && BY_ID.get(COSMETIC_FORMS[cosmetic.evolves].species)!.gen <= upTo) {
        mon.evos = [cosmetic.evolves];
        queue.push({ species: COSMETIC_FORMS[cosmetic.evolves].species, form: cosmetic.evolves });
      }
      continue;
    }
    const specie = specieFor(gen, species, form);
    const evos = (specie?.evos ?? []).map((name) => gen.species.get(name)).filter((s): s is Specie => !!s && BY_ID.has(s.num) && BY_ID.get(s.num)!.gen <= upTo);
    if (evos.length) {
      mon.evos = evos.map((s) => formFor(s) ?? String(s.num));
      for (const s of evos) queue.push({ species: s.num, form: formFor(s) });
    }
  }
  return mons;
}

/** The generation's type chart: chart[attacking][defending], where it isn't ×1. */
export function typeChart(gen: Generation): { types: string[]; chart: Record<string, Record<string, number>> } {
  const order = TYPES as readonly string[];
  const types = [...gen.types].map((t) => t.name).filter((n) => n !== "???" && n !== "Stellar");
  types.sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
  const chart: Record<string, Record<string, number>> = {};
  for (const a of types) {
    const eff = gen.types.get(a)!.effectiveness as Record<string, number>;
    for (const d of types) {
      const x = eff[d];
      if (x !== undefined && x !== 1) (chart[a.toLowerCase()] ??= {})[d.toLowerCase()] = x;
    }
  }
  return { types: types.map((t) => t.toLowerCase()), chart };
}

/** The Catch Rate Calculator's game ids (it covers Generation III on), by tracker game id. */
const CATCH_RATE: Record<string, string> = {
  "ruby-sapphire": "rse",
  emerald: "rse",
  "firered-leafgreen": "rse",
  "diamond-pearl": "dppt",
  platinum: "dppt",
  "heartgold-soulsilver": "hgss",
  "black-white": "bw",
  "black2-white2": "bw",
  "black-2-white-2": "bw",
  "x-y": "xy",
  "omega-ruby-alpha-sapphire": "oras",
  "sun-moon": "sm",
  "ultra-sun-ultra-moon": "usum",
  "sword-shield": "swsh",
  "scarlet-violet": "sv",
};
/** The Team Builder's format for a generation, where it has one (Generations III, IV and IX). */
const TEAM_FORMAT: Record<number, string> = { 3: "gen3ou", 4: "gen4ou", 9: "gen9ubers" };
/** The Legends games battle their own way (no abilities, their own moves): a Showdown format isn't theirs. */
const OWN_BATTLES = new Set(["legends-arceus", "legends-za"]);

/**
 * The generation whose Pokédex a game's Pokémon are looked up in: the game's own, but for Legends: Arceus. It's a
 * Generation VIII game, and Showdown's Generation VIII is Sword & Shield's, without Hisui's Pokémon and forms (Hisuian
 * Growlithe would be a Fire-type Growlithe, Overqwil nothing); its Generation IX has them.
 */
const DEX_GEN: Record<string, number> = { "legends-arceus": 9 };

/** An encounter's form in the tracker's (Showdown's) terms. */
const formOf = (e: { species: number; form?: string }): string | undefined => e.form ?? POKEAPI_DEFAULTS[e.species];

function areaView(a: NuzArea, versions: readonly string[], day: readonly string[]): ViewArea {
  const addOn = addOnOf(a.encounters);
  const lines = addOn ? a.encounters.map((e) => withoutPart(e, addOn)) : a.encounters;
  return {
    id: a.id,
    name: a.name,
    ...(addOn && { addOn }),
    // Each Pokémon once per way of meeting it and version, its lines summed up (Sword & Shield's Wild Area has hundreds).
    encounters: compactEncounters(lines, versions, day).map(({ species, form, ...e }) => {
      // The picture is the Pokémon's (in `mons`), not the encounter's.
      delete (e as { art?: number }).art;
      return { ...e, mon: monKey({ species, form: formOf({ species, form }) }) };
    }),
  };
}

export function buildView(game: NuzGame): GameView {
  const gen = generation(game.gen);
  const teamFormat = OWN_BATTLES.has(game.id) ? undefined : TEAM_FORMAT[game.gen];
  const areas = [...game.steps.flatMap((s) => (s.type === "area" ? [s.area] : [])), ...game.extra];
  const mons = collectMons(
    generation(DEX_GEN[game.id] ?? game.gen),
    game.gen,
    !!teamFormat,
    areas.flatMap((a) =>
      a.encounters.map((e) => {
        const form = formOf(e);
        return { species: e.species, ...(form && { form, ...(e.art && { art: e.art }) }) };
      })
    )
  );
  const keys = bossKeys(game.steps);
  let b = 0;
  const versionIds = game.versions.map((v) => v.id);
  const day = dayOf(areas.flatMap((a) => a.encounters));
  const steps: ViewStep[] = game.steps.map((s) => (s.type === "area" ? { type: "area", area: areaView(s.area, versionIds, day) } : { type: "boss", boss: { ...s.boss, key: keys[b++] } }));
  const { types, chart } = typeChart(gen);
  return {
    id: game.id,
    name: game.name,
    gen: game.gen,
    region: game.region,
    versions: game.versions,
    steps,
    extra: game.extra.map((a) => areaView(a, versionIds, day)),
    mons,
    dex: POKEDEX.filter((p) => p.gen <= game.gen).map((p) => [p.id, p.name]),
    types,
    chart,
    ...(CATCH_RATE[game.id] && { catchRate: CATCH_RATE[game.id] }),
    ...(teamFormat && { teamFormat }),
    sources: game.sources,
  };
}
