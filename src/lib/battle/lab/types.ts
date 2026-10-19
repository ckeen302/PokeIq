import type { TeamSet } from "@/lib/battle/sets";

/**
 * Battle Lab: two sides, a generation's mechanics and a strategy for each
 * side; Pokémon Showdown's simulator plays the battle thousands of times in
 * the browser and reports how often each side wins. These are the setup's
 * types and the rules around them, shared by the page, the workers and the
 * share links. Nothing here imports the simulator.
 */

export const LAB_GENS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
export type LabGen = (typeof LAB_GENS)[number];

export const LAB_GEN_GAMES: Record<LabGen, string> = {
  9: "Scarlet / Violet",
  8: "Sword / Shield",
  7: "Sun / Moon",
  6: "X / Y",
  5: "Black / White",
  4: "Diamond / Pearl / Platinum",
  3: "Ruby / Sapphire / Emerald",
  2: "Gold / Silver / Crystal",
  1: "Red / Blue / Yellow",
};

export const isLabGen = (n: unknown): n is LabGen => typeof n === "number" && (LAB_GENS as readonly number[]).includes(n);

/** Showdown's "Custom Game" for the generation: no tiers, no level rules, no team checks. */
export const labFormatId = (gen: LabGen, doubles: boolean) => `gen${gen}${doubles ? "doubles" : ""}customgame`;

/** Double battles arrived in Gen 3. */
export const doublesAllowed = (gen: LabGen) => gen >= 3;

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export const LAB_STRATEGIES = ["smart", "greedy", "random", "scripted"] as const;
export type LabStrategy = (typeof LAB_STRATEGIES)[number];

export const STRATEGY_INFO: Record<LabStrategy, { name: string; short: string; blurb: string }> = {
  smart: {
    name: "Smart",
    short: "The computer's Hard level",
    blurb:
      "Plays like the Hard computer opponent: KOs, priority to finish, safe setup, recovery, hazards, switching out of bad matchups and Tera. It reads the other side only as it has been revealed.",
  },
  greedy: {
    name: "Greedy",
    short: "Biggest expected hit",
    blurb: "Always the move with the highest expected damage (average roll × accuracy) on the foe. Never switches by choice, never Terastallizes.",
  },
  random: {
    name: "Random",
    short: "Any legal choice",
    blurb: "Any legal move, at random (it attacks 85% of the time and otherwise may switch). A baseline: how much does skill matter here?",
  },
  scripted: {
    name: "Scripted",
    short: "Moves in your order",
    blurb: "Each Pokémon uses the moves you list, in order: one move means always that move. Never switches by choice.",
  },
};

export const isLabStrategy = (s: unknown): s is LabStrategy => typeof s === "string" && (LAB_STRATEGIES as readonly string[]).includes(s);

// ---------------------------------------------------------------------------
// Starting conditions
// ---------------------------------------------------------------------------

export const LAB_STATUSES = ["", "brn", "par", "slp", "frz", "psn", "tox"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];

export const STATUS_NAMES: Record<LabStatus, string> = {
  "": "Healthy",
  brn: "Burned",
  par: "Paralyzed",
  slp: "Asleep",
  frz: "Frozen",
  psn: "Poisoned",
  tox: "Badly poisoned",
};

export const BOOST_IDS = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"] as const;
export type BoostId = (typeof BOOST_IDS)[number];
export const BOOST_NAMES: Record<BoostId, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };

/** Gen 1 has one Special stat: its stage is SpA's (and SpD follows it). */
export function boostIdsFor(gen: LabGen): BoostId[] {
  return gen === 1 ? BOOST_IDS.filter((b) => b !== "spd") : [...BOOST_IDS];
}

export const LAB_WEATHERS = ["", "raindance", "sunnyday", "sandstorm", "hail", "snowscape"] as const;
export type LabWeather = (typeof LAB_WEATHERS)[number];
export const WEATHER_NAMES: Record<LabWeather, string> = {
  "": "None",
  raindance: "Rain",
  sunnyday: "Harsh sunlight",
  sandstorm: "Sandstorm",
  hail: "Hail",
  snowscape: "Snow",
};

/** The weathers a generation has: none in Gen 1, Hail from Gen 3, Snow instead of Hail in Gen 9. */
export function weathersFor(gen: LabGen): LabWeather[] {
  if (gen === 1) return [""];
  const out: LabWeather[] = ["", "raindance", "sunnyday", "sandstorm"];
  if (gen >= 3 && gen <= 8) out.push("hail");
  if (gen >= 9) out.push("snowscape");
  return out;
}

export const LAB_TERRAINS = ["", "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain"] as const;
export type LabTerrain = (typeof LAB_TERRAINS)[number];
export const TERRAIN_NAMES: Record<LabTerrain, string> = {
  "": "None",
  electricterrain: "Electric Terrain",
  grassyterrain: "Grassy Terrain",
  mistyterrain: "Misty Terrain",
  psychicterrain: "Psychic Terrain",
};

/** Terrains arrived in Gen 6 (Psychic Terrain in Gen 7). */
export function terrainsFor(gen: LabGen): LabTerrain[] {
  if (gen < 6) return [""];
  return gen >= 7 ? [...LAB_TERRAINS] : ["", "electricterrain", "grassyterrain", "mistyterrain"];
}

/** Hazards and screens on one side of the field. */
export interface LabSideField {
  stealthrock: boolean;
  spikes: number;
  toxicspikes: number;
  stickyweb: boolean;
  reflect: boolean;
  lightscreen: boolean;
  auroraveil: boolean;
}

export const EMPTY_SIDE_FIELD: LabSideField = {
  stealthrock: false,
  spikes: 0,
  toxicspikes: 0,
  stickyweb: false,
  reflect: false,
  lightscreen: false,
  auroraveil: false,
};

export type SideFieldKey = keyof LabSideField;

export const SIDE_FIELD_NAMES: Record<SideFieldKey, string> = {
  stealthrock: "Stealth Rock",
  spikes: "Spikes",
  toxicspikes: "Toxic Spikes",
  stickyweb: "Sticky Web",
  reflect: "Reflect",
  lightscreen: "Light Screen",
  auroraveil: "Aurora Veil",
};

/** What each generation has, and how many layers stack (1 for an on/off condition). */
export function sideFieldFor(gen: LabGen): { key: SideFieldKey; layers: number }[] {
  const out: { key: SideFieldKey; layers: number }[] = [];
  if (gen >= 4) out.push({ key: "stealthrock", layers: 1 });
  if (gen >= 2) out.push({ key: "spikes", layers: gen === 2 ? 1 : 3 });
  if (gen >= 4) out.push({ key: "toxicspikes", layers: 2 });
  if (gen >= 6) out.push({ key: "stickyweb", layers: 1 });
  // Gen 1's Reflect and Light Screen belong to the Pokémon, not the side.
  if (gen >= 2) out.push({ key: "reflect", layers: 1 }, { key: "lightscreen", layers: 1 });
  if (gen >= 7) out.push({ key: "auroraveil", layers: 1 });
  return out;
}

// ---------------------------------------------------------------------------
// The setup
// ---------------------------------------------------------------------------

/** One Pokémon of a side: its set, its scripted moves and how it starts the battle. */
export interface LabMon {
  set: TeamSet;
  /** For the Scripted strategy: move names in the order they're used. */
  script: string[];
  /** Starting HP as a percentage of max, 1 to 100. */
  hp: number;
  status: LabStatus;
  /** Starting stat stages (−6 to +6). Only the Pokémon that start in battle keep them. */
  boosts: Partial<Record<BoostId, number>>;
}

export interface LabSide {
  /** 1 to 6 Pokémon; the first (first two in doubles) lead. */
  team: LabMon[];
  strategy: LabStrategy;
  /** Scripted: start the list over after the last move (otherwise the last move repeats). */
  loop: boolean;
  field: LabSideField;
}

export interface LabSetup {
  gen: LabGen;
  doubles: boolean;
  sides: [LabSide, LabSide];
  weather: LabWeather;
  /** Turns of weather left; 0 means it never ends. */
  weatherTurns: number;
  terrain: LabTerrain;
  terrainTurns: number;
}

export const SIDE_NAMES = ["Side A", "Side B"] as const;
export const SIDE_IDS = ["p1", "p2"] as const;

export const LAB_TEAM_SIZE = 6;
/** A battle still going after this many turns is stopped and counted as a draw. */
export const TURN_LIMIT = 300;
export const RUN_PRESETS = [100, 1_000, 10_000] as const;
export const MAX_RUNS = 50_000;
export const DEFAULT_RUNS = 1_000;

/** How many Pokémon start in battle per side. */
export const activeCount = (setup: Pick<LabSetup, "doubles">) => (setup.doubles ? 2 : 1);

/** What to call each side: "Piplup" for a one-Pokémon side, else (or in a mirror match) "Side A" / "Side B". */
export function sideLabels(setup: LabSetup): [string, string] {
  const one = (side: 0 | 1) => {
    const team = setup.sides[side].team;
    return team.length === 1 ? team[0].set.name || team[0].set.species : SIDE_NAMES[side];
  };
  const labels: [string, string] = [one(0), one(1)];
  return labels[0] === labels[1] ? [SIDE_NAMES[0], SIDE_NAMES[1]] : labels;
}
