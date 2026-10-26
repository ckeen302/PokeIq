/**
 * The competitive formats the Battle section supports. Ids are Pokémon
 * Showdown's, which is what the simulator validates and battles against, so a
 * saved team carries everything the battle engine needs to know its rules.
 */

export const BATTLE_FORMAT_IDS = [
  "gen9ou",
  "gen9ubers",
  "gen9uu",
  "gen9ru",
  "gen9nu",
  "gen9pu",
  "gen9lc",
  "gen9monotype",
  "gen9doublesou",
  "gen9vgc2025regi",
  "gen9nationaldex",
  "gen4ou",
  "gen3ou",
] as const;

export type BattleFormatId = (typeof BATTLE_FORMAT_IDS)[number];

export interface BattleFormat {
  id: BattleFormatId;
  name: string;
  gen: 3 | 4 | 9;
  gameType: "singles" | "doubles";
  /** The level new sets start at. */
  level: number;
  /** Which of a species' tiers describes it in this format. */
  tier: "tier" | "doublesTier" | "natDexTier";
  /** The tier the species search lists before anything is typed. */
  homeTier: string;
  /** National Dex: Pokémon, moves and items from earlier games are back. */
  natDex: boolean;
  /** "Min Source Gen = 9": only moves learnable in Scarlet / Violet. */
  paldeaOnly: boolean;
  /** The random-battle generator behind "Random team". */
  random: string;
  /** Same Type Clause: every Pokémon shares a type (random teams are drawn one type at a time). */
  monotype?: boolean;
  blurb: string;
}

export const BATTLE_FORMATS: Record<BattleFormatId, BattleFormat> = {
  gen9ou: {
    id: "gen9ou",
    name: "[Gen 9] OU",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "OU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "Smogon's flagship singles tier: everything below Ubers.",
  },
  gen9ubers: {
    id: "gen9ubers",
    name: "[Gen 9] Ubers",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "Uber",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "Box legendaries welcome. Only the most broken are banned.",
  },
  gen9uu: {
    id: "gen9uu",
    name: "[Gen 9] UU",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "UU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "The tier below OU: no OU or UUBL Pokémon.",
  },
  gen9ru: {
    id: "gen9ru",
    name: "[Gen 9] RU",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "RU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "The tier below UU: no UU or RUBL Pokémon.",
  },
  gen9nu: {
    id: "gen9nu",
    name: "[Gen 9] NU",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "NU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "The tier below RU: no RU or NUBL Pokémon.",
  },
  gen9pu: {
    id: "gen9pu",
    name: "[Gen 9] PU",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "PU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "The tier below NU: no NU or PUBL Pokémon.",
  },
  gen9lc: {
    id: "gen9lc",
    name: "[Gen 9] LC",
    gen: 9,
    gameType: "singles",
    level: 5,
    tier: "tier",
    homeTier: "LC",
    natDex: false,
    paldeaOnly: false,
    random: "gen9babyrandombattle",
    blurb: "Little Cup: first-stage Pokémon that can evolve, at level 5.",
  },
  gen9monotype: {
    id: "gen9monotype",
    name: "[Gen 9] Monotype",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "OU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randombattle",
    monotype: true,
    blurb: "Every Pokémon on a team shares a type. No Terastallizing.",
  },
  gen9doublesou: {
    id: "gen9doublesou",
    name: "[Gen 9] Doubles OU",
    gen: 9,
    gameType: "doubles",
    level: 100,
    tier: "doublesTier",
    homeTier: "DOU",
    natDex: false,
    paldeaOnly: false,
    random: "gen9randomdoublesbattle",
    blurb: "Two on two, Smogon's doubles tier list.",
  },
  gen9vgc2025regi: {
    id: "gen9vgc2025regi",
    name: "[Gen 9] VGC 2025 Reg I",
    gen: 9,
    gameType: "doubles",
    level: 50,
    tier: "doublesTier",
    homeTier: "DOU",
    natDex: false,
    paldeaOnly: true,
    random: "gen9randomdoublesbattle",
    blurb: "Official doubles: bring six, pick four, level 50, two restricted legendaries.",
  },
  gen9nationaldex: {
    id: "gen9nationaldex",
    name: "[Gen 9] National Dex",
    gen: 9,
    gameType: "singles",
    level: 100,
    tier: "natDexTier",
    homeTier: "OU",
    natDex: true,
    paldeaOnly: false,
    random: "gen9randombattle",
    blurb: "Scarlet / Violet mechanics with every Pokémon, Mega Stone and Z-Crystal back.",
  },
  gen4ou: {
    id: "gen4ou",
    name: "[Gen 4] OU",
    gen: 4,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "OU",
    natDex: false,
    paldeaOnly: false,
    random: "gen4randombattle",
    blurb: "Diamond / Pearl / Platinum: the physical / special split arrives.",
  },
  gen3ou: {
    id: "gen3ou",
    name: "[Gen 3] OU",
    gen: 3,
    gameType: "singles",
    level: 100,
    tier: "tier",
    homeTier: "OU",
    natDex: false,
    paldeaOnly: false,
    random: "gen3randombattle",
    blurb: "Ruby / Sapphire / Emerald: a move's type decides physical or special.",
  },
};

export const DEFAULT_FORMAT: BattleFormatId = "gen9ou";

export function isBattleFormatId(id: unknown): id is BattleFormatId {
  return typeof id === "string" && (BATTLE_FORMAT_IDS as readonly string[]).includes(id);
}

/** Gen 9 formats whose rules include Showdown's Terastal Clause (no Terastallizing). */
const TERASTAL_CLAUSE = new Set<string>(["gen9nationaldex", "gen9monotype"]);

/** Tera types only exist from Gen 9, and not where the Terastal Clause bans them. */
export function hasTera(format: { gen: number; id: string }): boolean {
  return format.gen >= 9 && !TERASTAL_CLAUSE.has(format.id);
}
