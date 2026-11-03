/**
 * Pokémon Mass Battle: the shapes shared by the roster (built on the server
 * from the repo's data), the damage table, the simulation and the page.
 * Client-safe: no data in here.
 */

export type SideIndex = 0 | 1;
export type Formation = "line" | "wedge" | "swarm" | "surround";
export type ArenaId = "plains" | "volcano" | "snowfield" | "colosseum";
/** Any level from 1 to 100. */
export type BattleLevel = number;
export type Spacing = "tight" | "normal" | "loose";
/** Who each Pokémon goes for: the nearest foe, the weakest or strongest near it, or the other side's boss wherever it is. */
export type Targeting = "nearest" | "weakest" | "strongest" | "boss";
/** Charge the other army, or hold the line until it comes close. */
export type Stance = "charge" | "hold";
/** Spread moves (Earthquake, Surf…): used when they hit more foes, or never. */
export type SpreadUse = "auto" | "never";
export type Weather = "none" | "sun" | "rain" | "sand" | "snow";
export type Terrain = "none" | "electric" | "grassy" | "psychic" | "misty";
export type TimeOfDay = "day" | "dusk" | "night";
/** Held items: none unless chosen (the fair default), or each species' random-battle item. */
export type ItemPolicy = "none" | "sets";
/** EV and IV spreads: random battles' (85 EVs and 31 IVs in everything), all-out attack, or all-out bulk. */
export type EvPreset = "random" | "offence" | "bulk";
export type CameraMode = "director" | "free" | "boss" | "top";
export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

export const FORMATIONS: Formation[] = ["line", "wedge", "swarm", "surround"];
export const ARENAS: ArenaId[] = ["plains", "volcano", "snowfield", "colosseum"];
/** Quick picks for the level (any 1–100 works). */
export const LEVELS: BattleLevel[] = [100, 50, 5];
export const SPACINGS: Spacing[] = ["tight", "normal", "loose"];
export const TARGETINGS: Targeting[] = ["nearest", "weakest", "strongest", "boss"];
export const STANCES: Stance[] = ["charge", "hold"];
export const SPREAD_USES: SpreadUse[] = ["auto", "never"];
export const WEATHERS: Weather[] = ["none", "sun", "rain", "sand", "snow"];
export const TERRAINS: Terrain[] = ["none", "electric", "grassy", "psychic", "misty"];
export const TIMES: TimeOfDay[] = ["day", "dusk", "night"];
export const EV_PRESETS: EvPreset[] = ["random", "offence", "bulk"];
export const CAMERA_MODES: CameraMode[] = ["director", "free", "boss", "top"];
export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export const TYPE_NAMES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"] as const;

export const FORMATION_LABEL: Record<Formation, string> = { line: "Line", wedge: "Wedge", swarm: "Swarm", surround: "Surround" };
export const ARENA_LABEL: Record<ArenaId, string> = { plains: "Plains", volcano: "Volcano", snowfield: "Snowfield", colosseum: "Colosseum" };
export const SPACING_LABEL: Record<Spacing, string> = { tight: "Tight", normal: "Normal", loose: "Loose" };
export const TARGETING_LABEL: Record<Targeting, string> = { nearest: "Nearest", weakest: "Weakest near", strongest: "Strongest near", boss: "Focus the boss" };
export const STANCE_LABEL: Record<Stance, string> = { charge: "Charge", hold: "Hold the line" };
export const SPREAD_LABEL: Record<SpreadUse, string> = { auto: "Use them", never: "Avoid them" };
export const WEATHER_LABEL: Record<Weather, string> = { none: "Clear", sun: "Harsh sunlight", rain: "Rain", sand: "Sandstorm", snow: "Snow" };
export const TERRAIN_LABEL: Record<Terrain, string> = { none: "None", electric: "Electric Terrain", grassy: "Grassy Terrain", psychic: "Psychic Terrain", misty: "Misty Terrain" };
export const TIME_LABEL: Record<TimeOfDay, string> = { day: "Day", dusk: "Dusk", night: "Night" };
export const EV_LABEL: Record<EvPreset, string> = { random: "Random battles (85 EVs, 31 IVs)", offence: "Max offence", bulk: "Max bulk" };
export const CAMERA_LABEL: Record<CameraMode, string> = { director: "Director", free: "Free", boss: "Follow the boss", top: "Top-down" };

export type StatTable = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

/** A major status condition (0 for none), as the engine stores it. */
export const STATUS = { none: 0, par: 1, brn: 2, psn: 3, tox: 4, slp: 5, frz: 6 } as const;
export type StatusId = "par" | "brn" | "psn" | "tox" | "slp" | "frz";
export const STATUS_IDS: ("" | StatusId)[] = ["", "par", "brn", "psn", "tox", "slp", "frz"];

/** A stat stage change: on the target, or on the user. */
export type Boosts = Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;

/** One of a move's side effects (Showdown's secondaries and self effects): a chance in percent. */
export interface MoveEffect {
  chance: number;
  /** "target": the Pokémon hit; "self": the user. */
  on: "target" | "self";
  status?: StatusId;
  flinch?: boolean;
  confuse?: boolean;
  boosts?: Boosts;
  /** The move's own after-effect on the user (Close Combat, Draco Meteor), not a side effect. */
  always?: boolean;
}

/** A move as the battle uses it: Showdown's data (@pkmn/dex) for its rules, the calculator for its damage. */
export interface MBMove {
  /** Showdown's name (what the damage calculator takes). */
  name: string;
  /** Capitalised type ("Water"). */
  type: string;
  cat: "Physical" | "Special";
  /** Base power (0 for moves whose power the calculator works out: Flail, Low Kick…). */
  bp: number;
  /** Accuracy in percent; 0 never misses. */
  acc: number;
  pri: number;
  contact: boolean;
  /** Hits every foe around the user (Showdown's target allAdjacent or allAdjacentFoes). */
  spread: boolean;
  /** Multi-hit moves: fewest and most hits. */
  hits: [number, number] | null;
  /** Each hit of a multi-hit move checks accuracy (Triple Axel, Population Bomb). */
  multiAcc: boolean;
  /** Critical-hit stage bonus (1 for Stone Edge, Slash…); 3 always lands a critical hit. */
  crit: number;
  recoil: [number, number] | null;
  drain: [number, number] | null;
  /** Side effects: Thunderbolt's 10% paralysis, Crunch's Defense drop, Close Combat's own drops, Iron Head's flinch… */
  fx?: MoveEffect[];
  /** Which of the user's stats it attacks with when it isn't the usual one: Body Press (Defense), Foul Play (the target's Attack). */
  atkStat?: "def" | "target-atk" | "best";
  /** Hits the target's Defense with a special move (Psyshock, Psystrike, Secret Sword). */
  hitsDef?: boolean;
  /** Sound moves (Hyper Voice, Boomburst…): through Substitute, blocked by Soundproof. */
  sound?: boolean;
  /** Thaws the user out (Flame Wheel, Scald, Flare Blitz…). */
  thaws?: boolean;
  /** Locks the user in for two or three turns, then confuses it (Outrage, Thrash, Petal Dance, Raging Fury). */
  rampage?: boolean;
  /** Hurts the user (half its max HP) when it misses (High Jump Kick, Axe Kick, Supercell Slam). */
  crash?: boolean;
}

/** A species (or form) and its default set, as the battle needs it. Stats from src/data/pokedex.json and Showdown's data. */
export interface MBSpecies {
  /** National Dex number, or PokéAPI's id for a form (10100 Alolan Raichu…). */
  id: number;
  /** The species it's a form of (its own id for a default form). */
  of: number;
  slug: string;
  name: string;
  /** The damage calculator's name for it. */
  calc: string;
  /** Lowercase types. */
  types: string[];
  base: StatTable;
  /** Height (m) and weight (kg). */
  m: number;
  kg: number;
  shape: string | null;
  gen: number;
  legendary: boolean;
  mythical: boolean;
  fullyEvolved: boolean;
  /** "mega", "alola", "galar", "hisui", "paldea", or "" for a default form. */
  form: string;
  /** Every ability it can have, its default first. */
  abilities: string[];
  /** Its default ability: the random-battle set's, or its first regular one. */
  ability: string;
  /** The random-battle set's held item, when it's one the battle models ("" for none): held only with items on. */
  item: string;
  /** Tera types its random-battle set uses (empty without a set). */
  tera: string[];
  /** The random-battle set's attacking moves the battle can play (move indices), or null without a set. */
  randbats: number[] | null;
  /** Attacking moves learnt by levelling up: [move index, level]. */
  levelUp: [number, number][];
  /** Where the default moves come from. */
  source: "randbats" | "learnset";
  /** The HOME render's visible box [x, y, w, h, image size], for the 3D figure. */
  box: [number, number, number, number, number];
}

/** Everything the battle can use: species by id, moves by index. */
export interface Roster {
  version: number;
  moves: MBMove[];
  species: MBSpecies[];
}

/** A species' set as chosen (anything left out is its default at the battle's level). */
export interface SetChoice {
  level?: number;
  /** Up to four move names (Showdown's). */
  moves?: string[];
  ability?: string;
  /** "" for none. */
  item?: string;
  nature?: string;
  evs?: EvPreset;
  /** Terastallized into this type from the start ("" or left out: no Tera). */
  tera?: string;
}

/** A set in full, as the engine and the damage calculator take it. */
export interface UnitSet {
  level: number;
  moves: MBMove[];
  ability: string;
  item: string;
  nature: string;
  evs: StatTable;
  ivs: StatTable;
  evPreset: EvPreset;
  tera: string;
}

/** Every species matching all of a filter's parts. */
export interface GroupRule {
  /** Lowercase types: one means "has this type", two "has both". */
  types?: string[];
  gen?: number;
  /** Legendaries (and mythicals with `mythical`), or none of them with "no". */
  legendary?: boolean | "no";
  mythical?: boolean;
  fullyEvolved?: boolean;
}

/** One row of an army: a species (or form) and how many, or a group of species with a count each. */
export interface UnitSpec {
  /** Species id (0 for a group). */
  id: number;
  count: number;
  group?: GroupRule;
  set?: SetChoice;
}

/** One army: up to four rows, its formation and how it fights. */
export interface ArmySpec {
  units: UnitSpec[];
  formation: Formation;
  spacing?: Spacing;
  targeting?: Targeting;
  stance?: Stance;
  spread?: SpreadUse;
}

/** The field: the arena and what's in the air and on the ground. */
export interface FieldSpec {
  weather: Weather;
  terrain: Terrain;
  time: TimeOfDay;
}

/** How the battle is shown (not part of what happens in it). */
export interface PlaybackSpec {
  speed: number;
  /** Slow motion on the big moments. */
  slowmo: boolean;
  /** Damage numbers over the hits. */
  numbers: boolean;
  hud: boolean;
  camera: CameraMode;
}

export const DEFAULT_PLAYBACK: PlaybackSpec = { speed: 1, slowmo: true, numbers: false, hud: true, camera: "director" };
export const DEFAULT_FIELD: FieldSpec = { weather: "none", terrain: "none", time: "day" };

/** A battle, fully determined (the share link encodes exactly this). */
export interface BattleSpec {
  sides: [ArmySpec, ArmySpec];
  /** Everyone's level unless their set says otherwise. */
  level: BattleLevel;
  arena: ArenaId;
  seed: number;
  /** Left out: clear skies, no terrain, daytime. */
  field?: FieldSpec;
  /** Left out: no held items unless chosen. */
  items?: ItemPolicy;
}

/** "How many X beat Y?": the smallest army of `army` (its rows share the army evenly) that beats `boss`. */
export interface Question {
  /** The army whose size is the answer: its rows' species (counts are ignored), sets and behaviour. */
  army: ArmySpec;
  /** What it has to beat (one boss, usually). */
  boss: ArmySpec;
  level: BattleLevel;
  arena: ArenaId;
  field?: FieldSpec;
  items?: ItemPolicy;
  /** Share of battles the army must win (0.5 or 0.9). */
  threshold?: number;
  /** Battles per army size. */
  runs?: number;
}

export type Winner = 0 | 1 | 2; // side A, side B, draw (time ran out)

export interface BattleOutcome {
  winner: Winner;
  /** Simulated seconds. */
  seconds: number;
  /** Units left standing per side. */
  left: [number, number];
  /** KOs each side scored. */
  kos: [number, number];
  /** Damage each side dealt. */
  dealt: [number, number];
}

export const fieldOf = (s: { field?: FieldSpec }): FieldSpec => s.field ?? DEFAULT_FIELD;
export const itemsOf = (s: { items?: ItemPolicy }): ItemPolicy => s.items ?? "none";
export const sideTotal = (a: ArmySpec) => a.units.reduce((n, u) => n + u.count, 0);
/** The question's first challenger and boss species (for names and pictures). */
export const questionLead = (q: Question) => ({ challenger: q.army.units[0]?.id ?? 0, boss: q.boss.units[0]?.id ?? 0 });
