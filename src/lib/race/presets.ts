import { finishTime, runnerFor } from "./model";
import type { Distance } from "./track";
import type { Entrant } from "./types";

/**
 * The ready-made races on /pokedex/race. Each has its own page
 * (/pokedex/race/<id>) with a preview card, a hook for its video, and a
 * distance. Picks are computed from the data (fastest by the model's
 * finish time, heaviest by Pokédex weight…), never hand-ranked. Pure and
 * unit-tested.
 */

export interface RacePreset {
  id: string;
  label: string;
  /** Page title. */
  title: string;
  /** The video's hook card. */
  hook: string;
  blurb: string;
  distance: Distance;
  /** "Every Pokémon" is a knockout tournament, not a single race. */
  tournament?: boolean;
  pick(all: Entrant[], distance: Distance): Entrant[];
}

/** First-stage starters, Bulbasaur to Quaxly (their evolution chains make the starter lines). */
export const STARTER_BASES = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912] as const;
/**
 * The pseudo-legendaries: non-legendary three-stage lines whose final form
 * has a 600 base stat total (checked against the Pokédex in the tests).
 */
export const PSEUDO_LEGENDARIES = [149, 248, 373, 376, 445, 635, 706, 784, 887, 998] as const;
export const EEVEE = 133;
export const SHUCKLE = "shuckle";
export const REGIELEKI = "regieleki";

const species = (all: Entrant[]) => all.filter((e) => e.kind === "pokemon");

/** Predicted finish time over a distance (cached per entrant and distance). */
const cache = new WeakMap<Entrant, Map<number, number>>();
export function predicted(e: Entrant, d: Distance): number {
  let m = cache.get(e);
  if (!m) { m = new Map(); cache.set(e, m); }
  let t = m.get(d);
  if (t === undefined) { t = finishTime(runnerFor(e.stats, e.kg), d); m.set(d, t); }
  return t;
}

/** Fastest first; equal times by Dex number. */
export const byTime = (d: Distance) => (a: Entrant, b: Entrant) => predicted(a, d) - predicted(b, d) || a.species - b.species || a.key.localeCompare(b.key);

const fastest = (list: Entrant[], d: Distance, n = 8) => [...list].sort(byTime(d)).slice(0, n);

export const PRESETS: RacePreset[] = [
  {
    id: "fastest-eight",
    label: "Fastest Eight",
    title: "The fastest Pokémon: the 100 m final",
    hook: "The 8 fastest Pokémon race 100 m ⚡",
    blurb: "The eight fastest Pokémon by base Speed and acceleration, in the 100 m final.",
    distance: 100,
    pick: (all, d) => fastest(species(all), d),
  },
  {
    id: "slowest-eight",
    label: "Slowest Eight",
    title: "The slowest Pokémon race 100 m",
    hook: "The 8 slowest Pokémon race 100 m 🐌",
    blurb: "Shuckle, Munchlax and the other slowest Pokémon over 100 m. Bring a snack.",
    distance: 100,
    pick: (all, d) => [...species(all)].sort(byTime(d)).reverse().slice(0, 8).reverse(),
  },
  {
    id: "shuckle-vs-regieleki",
    label: "Shuckle vs Regieleki",
    title: "Shuckle vs Regieleki: the slowest Pokémon against the fastest",
    hook: "Shuckle vs Regieleki 😳",
    blurb: "Base Speed 5 against base Speed 200 over 100 m.",
    distance: 100,
    pick: (all) => [SHUCKLE, REGIELEKI].flatMap((k) => all.filter((e) => e.key === k)),
  },
  {
    id: "gen-1-final",
    label: "Gen 1 final",
    title: "The fastest Gen 1 Pokémon: the 100 m final",
    hook: "Fastest Gen 1 Pokémon? 100 m final 🏁",
    blurb: "The eight fastest of the original 151.",
    distance: 100,
    pick: (all, d) => fastest(species(all).filter((e) => e.gen === 1), d),
  },
  {
    id: "starters",
    label: "Starters",
    title: "The fastest starter Pokémon (final evolutions)",
    hook: "Which starter is fastest? 🔥💧🌿",
    blurb: "The eight fastest fully evolved starters, Venusaur to Quaquaval.",
    distance: 100,
    pick: (all, d) => {
      const chains = new Set(species(all).filter((e) => (STARTER_BASES as readonly number[]).includes(e.species)).map((e) => e.chain));
      return fastest(species(all).filter((e) => chains.has(e.chain) && e.evolved), d);
    },
  },
  {
    id: "legendaries",
    label: "Legendaries",
    title: "The fastest Legendary and Mythical Pokémon: 200 m",
    hook: "Legendary Pokémon race 200 m 👑",
    blurb: "The eight fastest Legendary and Mythical Pokémon over 200 m, round the bend.",
    distance: 200,
    pick: (all, d) => fastest(species(all).filter((e) => e.legendary || e.mythical), d),
  },
  {
    id: "eeveelutions",
    label: "Eeveelutions",
    title: "Every Eeveelution races 100 m",
    hook: "Which Eeveelution is fastest? ✨",
    blurb: "Vaporeon, Jolteon, Flareon, Espeon, Umbreon, Leafeon, Glaceon and Sylveon.",
    distance: 100,
    pick: (all) => {
      const chain = all.find((e) => e.kind === "pokemon" && e.species === EEVEE)?.chain;
      return species(all).filter((e) => e.chain === chain && e.species !== EEVEE).sort((a, b) => a.species - b.species).slice(0, 8);
    },
  },
  {
    id: "pseudo-legendaries",
    label: "Pseudo-legendaries",
    title: "Pseudo-legendary Pokémon race 400 m",
    hook: "Pseudo-legendaries race a full lap 🐉",
    blurb: "The eight fastest pseudo-legendaries over one lap, where stamina (HP) starts to count.",
    distance: 400,
    pick: (all, d) => fastest(species(all).filter((e) => (PSEUDO_LEGENDARIES as readonly number[]).includes(e.species)), d),
  },
  {
    id: "heavyweights",
    label: "Heavyweights",
    title: "The heaviest Pokémon race 100 m",
    hook: "The heaviest Pokémon race 100 m 🏋️",
    blurb: "The eight heaviest Pokémon, each close to a tonne. Mind the ground.",
    distance: 100,
    pick: (all) => [...species(all)].sort((a, b) => b.kg - a.kg || a.species - b.species).slice(0, 8),
  },
  {
    id: "every-pokemon",
    label: "Every Pokémon",
    title: "Every Pokémon in one knockout tournament",
    hook: "Every Pokémon races. One winner 🏆",
    blurb: "Every Pokémon drawn into heats of eight, through the rounds to one 100 m final.",
    distance: 100,
    tournament: true,
    pick: (all) => species(all),
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
export const DEFAULT_PRESET = PRESETS[0];
