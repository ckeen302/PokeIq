import "server-only";
import { Generations, type Data, type Generation, type Specie } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import POKEDEX_DATA from "@/data/pokedex.json";
import DETAILS from "@/data/pokedex-details.json";
import SIZES_ART from "@/data/sizes-art.json";
import { TYPES } from "@/lib/pokemon/type-matrix";
import type { NuzArea, NuzGame } from "./model";
import { bossKeys, monKey, type GameView, type ViewArea, type ViewMon, type ViewStep } from "./view";

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
const HAS_ART = new Set(Object.keys(SIZES_ART as Record<string, unknown>).map(Number));

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

/** PokéAPI's form name for a Showdown forme ("Raichu-Alola" → "raichu-alola"), or undefined for a species' default. */
export function formFor(s: Specie): string | undefined {
  if (!s.forme) return undefined;
  const known = POKEAPI_FORM.get(s.name);
  if (known) return known;
  const base = BY_ID.get(s.num)?.slug ?? s.baseSpecies.toLowerCase();
  const forme = s.forme.toLowerCase().replace(/['’%.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base}-${forme}`;
}

function viewMon(gen: Generation, species: number, form: string | undefined): ViewMon | null {
  const row = BY_ID.get(species);
  if (!row) return null;
  const f = form ? FORMS.get(form) : undefined;
  const specie = specieFor(gen, species, form);
  const art = f && HAS_ART.has(f.id) ? f.id : species;
  return {
    key: form ?? String(species),
    species,
    ...(form && { form }),
    name: f?.name ?? (form && specie?.forme ? specie.name : row.name),
    slug: row.slug,
    art,
    types: (specie?.types ?? []).map((t) => t.toLowerCase()),
    family: row.chain,
    showdown: specie?.name ?? row.name,
  };
}

/** Each Pokémon of the game, and everything it can evolve into in the generation (each with its own evolutions). */
function collectMons(gen: Generation, seeds: { species: number; form?: string }[]): Record<string, ViewMon> {
  const mons: Record<string, ViewMon> = {};
  const queue = [...seeds];
  while (queue.length) {
    const { species, form } = queue.shift()!;
    const key = form ?? String(species);
    if (mons[key]) continue;
    const mon = viewMon(gen, species, form);
    if (!mon) continue;
    mons[key] = mon;
    const specie = specieFor(gen, species, form);
    const evos = (specie?.evos ?? []).map((name) => gen.species.get(name)).filter((s): s is Specie => !!s && BY_ID.has(s.num) && BY_ID.get(s.num)!.gen <= gen.num);
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

const areaView = (a: NuzArea): ViewArea => ({
  id: a.id,
  name: a.name,
  encounters: a.encounters.map(({ species: _s, form: _f, ...e }) => ({ ...e, mon: monKey({ species: _s, form: _f }) })),
});

export function buildView(game: NuzGame): GameView {
  const gen = generation(game.gen);
  const areas = [...game.steps.flatMap((s) => (s.type === "area" ? [s.area] : [])), ...game.extra];
  const mons = collectMons(
    gen,
    areas.flatMap((a) => a.encounters.map((e) => ({ species: e.species, ...(e.form && { form: e.form }) })))
  );
  const keys = bossKeys(game.steps);
  let b = 0;
  const steps: ViewStep[] = game.steps.map((s) => (s.type === "area" ? { type: "area", area: areaView(s.area) } : { type: "boss", boss: { ...s.boss, key: keys[b++] } }));
  const { types, chart } = typeChart(gen);
  return {
    id: game.id,
    name: game.name,
    gen: game.gen,
    region: game.region,
    versions: game.versions,
    steps,
    extra: game.extra.map(areaView),
    mons,
    dex: POKEDEX.filter((p) => p.gen <= game.gen).map((p) => [p.id, p.name]),
    types,
    chart,
    ...(CATCH_RATE[game.id] && { catchRate: CATCH_RATE[game.id] }),
    ...(TEAM_FORMAT[game.gen] && { teamFormat: TEAM_FORMAT[game.gen] }),
    sources: game.sources,
  };
}
