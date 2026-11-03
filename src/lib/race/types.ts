/**
 * Pokémon Race (/pokedex/race): the shared, client-safe model of a runner.
 * Every entrant is a Pokémon (default form) or an alternate form with its
 * own base stats (a Mega, a regional form, Deoxys-Speed…). Stats, height
 * and weight are the documented numbers only: lib/race/data builds them
 * from the Pokédex and from PokéAPI's form data (scripts/race-data.ts).
 */

export type RaceKind = "pokemon" | "mega" | "regional" | "form";

/** How a runner moves down its lane (lib/race/gait decides it from shape, types and abilities). */
export type Motion = "run" | "gallop" | "scuttle" | "fly" | "hover" | "slither" | "flop" | "roll" | "bounce" | "swim";

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface Entrant {
  /** The Pokémon's or form's PokéAPI name ("regieleki", "deoxys-speed"). */
  key: string;
  name: string;
  kind: RaceKind;
  /** National Dex number. */
  species: number;
  /** PokéAPI id of the HOME render (the species id or the form's 10xxx id). */
  art: number;
  stats: Stats;
  /** The Pokédex size in metres: a height, or a length for long serpents and fish (`length`). */
  m: number;
  /** Measured along its longest side (the Sizes "(Length)" rule: serpent- or fish-shaped and wider than tall). */
  length: boolean;
  /** Weight in kg (Pokédex). */
  kg: number;
  /** PokéAPI body shape of the species ("upright", "quadruped", "wings"…). */
  shape: string | null;
  types: string[];
  motion: Motion;
  gen: number;
  legendary: boolean;
  mythical: boolean;
  /** Evolution chain id. */
  chain: number;
  /** Fully evolved (Pokédex). */
  evolved: boolean;
  /** The HOME render's visible box: left, top, width, height (px) in an image `size` px square. */
  box: [x: number, y: number, w: number, h: number, size: number];
  /** Where the figure's relief map lives: the Sizes set, or the race's own forms. */
  depth: "sizes" | "race";
}

export const KIND_LABEL: Record<RaceKind, string> = {
  pokemon: "Pokémon",
  mega: "Mega Evolution",
  regional: "Regional form",
  form: "Alternate form",
};

const MOTIONS: Motion[] = ["run", "gallop", "scuttle", "fly", "hover", "slither", "flop", "roll", "bounce", "swim"];
const KINDS: RaceKind[] = ["pokemon", "mega", "regional", "form"];
const F_LEGEND = 1, F_MYTH = 2, F_RACE_DEPTH = 4, F_LENGTH = 8, F_EVOLVED = 16;

/** The compact wire format of /api/race (one row per entrant). */
export type EntrantRow = [
  key: string,
  name: string,
  kind: number,
  species: number,
  art: number,
  stats: [number, number, number, number, number, number],
  dm: number,
  hg: number,
  shape: string,
  types: string,
  motion: number,
  gen: number,
  flags: number,
  chain: number,
  box: [number, number, number, number, number],
];

export function toRow(e: Entrant): EntrantRow {
  const s = e.stats;
  const flags = (e.legendary ? F_LEGEND : 0) | (e.mythical ? F_MYTH : 0) | (e.depth === "race" ? F_RACE_DEPTH : 0) | (e.length ? F_LENGTH : 0) | (e.evolved ? F_EVOLVED : 0);
  return [e.key, e.name, KINDS.indexOf(e.kind), e.species, e.art, [s.hp, s.atk, s.def, s.spa, s.spd, s.spe], Math.round(e.m * 10), Math.round(e.kg * 10), e.shape ?? "", e.types.join("/"), MOTIONS.indexOf(e.motion), e.gen, flags, e.chain, e.box];
}

export function fromRow(r: EntrantRow): Entrant {
  const [key, name, kind, species, art, [hp, atk, def, spa, spd, spe], dm, hg, shape, types, motion, gen, flags, chain, box] = r;
  return {
    key,
    name,
    kind: KINDS[kind] ?? "pokemon",
    species,
    art,
    stats: { hp, atk, def, spa, spd, spe },
    m: dm / 10,
    length: !!(flags & F_LENGTH),
    kg: hg / 10,
    shape: shape || null,
    types: types ? types.split("/") : [],
    motion: MOTIONS[motion] ?? "run",
    gen,
    legendary: !!(flags & F_LEGEND),
    mythical: !!(flags & F_MYTH),
    chain,
    evolved: !!(flags & F_EVOLVED),
    box,
    depth: flags & F_RACE_DEPTH ? "race" : "sizes",
  };
}

/** World size of the figure (m): the documented size along its height (or its longest side for a length), the other side from the render's proportions. */
export function figureSize(e: Pick<Entrant, "m" | "box" | "length">): { w: number; h: number } {
  const [, , bw, bh] = e.box;
  const a = bw / Math.max(1, bh);
  if (e.length && a >= 1) return { w: e.m, h: e.m / a };
  return { w: e.m * a, h: e.m };
}

/** "#0025" */
export const dexTag = (dex: number) => `#${String(dex).padStart(4, "0")}`;
