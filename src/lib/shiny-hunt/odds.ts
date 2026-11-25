/**
 * Shiny odds for the Shiny Hunt Counter: every game and method it offers, and the chance one encounter is shiny.
 *
 * Sources (the well-known mechanics; nothing here is estimated):
 *  - Bulbapedia, "Shiny Pokémon" (base rates, Shiny Charm, Masuda method, chain fishing, SOS Battles, catch combos,
 *    Legends: Arceus research and outbreaks, Scarlet/Violet outbreaks and Sparkling Power) and "Shiny Charm".
 *  - Serebii's shiny pages for each game, which tabulate the same figures:
 *    serebii.net/scarletviolet/shinypokemon.shtml, /swordshield/shinypokemon.shtml,
 *    /letsgopikachueevee/shinypokemon.shtml, /ultrasunultramoon/sosbattles.shtml, /legendsarceus/shinypokemon.shtml,
 *    /legendsz-a/shinypokemon.shtml.
 *
 * How the games work: each encounter makes one or more independent shiny checks ("rolls") at the base rate (1/8192 in
 * Generations 2–5, 1/4096 from X and Y on); the Shiny Charm, the Masuda method, chains and outbreaks add rolls. So
 * P(shiny) = 1 − (1 − 1/base)^rolls. A few methods are a flat chance instead (Gen 2 breeding with a shiny parent,
 * Dynamax Adventures). Methods whose figures aren't settled (the Poké Radar, DexNav, Sword/Shield's number battled,
 * the Friend Safari) are left out rather than guessed.
 */

export type GameId = "gsc" | "rse" | "frlg" | "dppt" | "hgss" | "bw" | "b2w2" | "xy" | "oras" | "sm" | "usum" | "lgpe" | "swsh" | "bdsp" | "pla" | "sv" | "za";

export type MethodId =
  | "wild"
  | "breeding"
  | "masuda"
  | "chainFishing"
  | "horde"
  | "sos"
  | "catchCombo"
  | "dynamax"
  | "outbreak"
  | "massiveOutbreak";

/** A choice that adds rolls (Legends: Arceus research level, Scarlet/Violet Sparkling Power and outbreak KOs). */
export type ChoiceId = "research" | "sparkling" | "cleared";

export interface Choice {
  id: ChoiceId;
  /** Each option's id and the rolls it adds; the first is the default. */
  options: readonly { id: string; rolls: number }[];
}

export interface Method {
  id: MethodId;
  /** Rolls per encounter before any bonus (1; 5 or 6 for the Masuda method). */
  rolls: number;
  /** Rolls the Shiny Charm adds; absent where the charm doesn't apply. */
  charm?: number;
  /** Rolls a Lure adds (Let's Go). */
  lure?: number;
  /** A chain's extra rolls: [chain length from which the tier applies, rolls it adds], ascending. */
  chain?: readonly (readonly [number, number])[];
  choices?: readonly Choice[];
  /** A flat chance instead of rolls: 1 in `oneIn` (1 in `charmOneIn` with the charm). */
  flat?: { oneIn: number; charmOneIn?: number };
  /** The counter's default step (a horde is five Pokémon at once). */
  step?: number;
}

export interface Game {
  id: GameId;
  gen: number;
  base: 4096 | 8192;
  methods: readonly Method[];
}

const RESEARCH: Choice = { id: "research", options: [{ id: "none", rolls: 0 }, { id: "lv10", rolls: 1 }, { id: "perfect", rolls: 3 }] };
const SPARKLING: Choice = { id: "sparkling", options: [{ id: "0", rolls: 0 }, { id: "1", rolls: 1 }, { id: "2", rolls: 2 }, { id: "3", rolls: 3 }] };
const CLEARED: Choice = { id: "cleared", options: [{ id: "0", rolls: 0 }, { id: "30", rolls: 1 }, { id: "60", rolls: 2 }] };

/** Chain fishing (X/Y, Omega Ruby/Alpha Sapphire): two extra rolls per Pokémon hooked in a row, up to 20. */
const FISHING_CHAIN: readonly (readonly [number, number])[] = Array.from({ length: 20 }, (_, i) => [i + 1, 2 * (i + 1)] as const);

const wild = (charm?: number): Method => ({ id: "wild", rolls: 1, ...(charm && { charm }) });
const masuda = (rolls: number, charm?: number): Method => ({ id: "masuda", rolls, ...(charm && { charm }) });

export const GAMES: readonly Game[] = [
  { id: "gsc", gen: 2, base: 8192, methods: [wild(), { id: "breeding", rolls: 1, flat: { oneIn: 64 } }] },
  { id: "rse", gen: 3, base: 8192, methods: [wild()] },
  { id: "frlg", gen: 3, base: 8192, methods: [wild()] },
  { id: "dppt", gen: 4, base: 8192, methods: [wild(), masuda(5)] },
  { id: "hgss", gen: 4, base: 8192, methods: [wild(), masuda(5)] },
  { id: "bw", gen: 5, base: 8192, methods: [wild(), masuda(6)] },
  { id: "b2w2", gen: 5, base: 8192, methods: [wild(2), masuda(6, 2)] },
  { id: "xy", gen: 6, base: 4096, methods: [wild(2), masuda(6, 2), { id: "chainFishing", rolls: 1, charm: 2, chain: FISHING_CHAIN }, { id: "horde", rolls: 1, charm: 2, step: 5 }] },
  { id: "oras", gen: 6, base: 4096, methods: [wild(2), masuda(6, 2), { id: "chainFishing", rolls: 1, charm: 2, chain: FISHING_CHAIN }, { id: "horde", rolls: 1, charm: 2, step: 5 }] },
  { id: "sm", gen: 7, base: 4096, methods: [wild(2), masuda(6, 2), { id: "sos", rolls: 1, charm: 2, chain: [[11, 4], [21, 8], [31, 12]] }] },
  { id: "usum", gen: 7, base: 4096, methods: [wild(2), masuda(6, 2), { id: "sos", rolls: 1, charm: 2, chain: [[11, 4], [21, 8], [31, 12]] }] },
  { id: "lgpe", gen: 7, base: 4096, methods: [{ id: "catchCombo", rolls: 1, charm: 2, lure: 1, chain: [[11, 3], [21, 7], [31, 11]] }] },
  { id: "swsh", gen: 8, base: 4096, methods: [wild(2), masuda(6, 2), { id: "dynamax", rolls: 1, flat: { oneIn: 300, charmOneIn: 100 } }] },
  // Brilliant Diamond/Shining Pearl: the Shiny Charm is counted for eggs only, so only the Masuda method offers it.
  { id: "bdsp", gen: 8, base: 4096, methods: [wild(), masuda(6, 2)] },
  {
    id: "pla",
    gen: 8,
    base: 4096,
    methods: [
      { id: "wild", rolls: 1, charm: 3, choices: [RESEARCH] },
      { id: "outbreak", rolls: 26, charm: 3, choices: [RESEARCH] },
      { id: "massiveOutbreak", rolls: 13, charm: 3, choices: [RESEARCH] },
    ],
  },
  {
    id: "sv",
    gen: 9,
    base: 4096,
    methods: [
      { id: "wild", rolls: 1, charm: 2, choices: [SPARKLING] },
      { id: "outbreak", rolls: 1, charm: 2, choices: [CLEARED, SPARKLING] },
      masuda(6, 2),
    ],
  },
  { id: "za", gen: 9, base: 4096, methods: [wild(3)] },
];

export const GAME_IDS = GAMES.map((g) => g.id);
const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

export function getGame(id: string): Game | undefined {
  return BY_ID.get(id as GameId);
}

export function getMethod(game: GameId, method: string): Method | undefined {
  return BY_ID.get(game)?.methods.find((m) => m.id === method);
}

/** The settings that change a method's odds. */
export interface OddsInput {
  charm: boolean;
  lure: boolean;
  chain: number;
  choices: Partial<Record<ChoiceId, string>>;
}

export const NO_BONUS: OddsInput = { charm: false, lure: false, chain: 0, choices: {} };

/** The extra rolls a chain of this length gives (0 below the first tier). */
export function chainRolls(m: Method, chain: number): number {
  let extra = 0;
  for (const [from, rolls] of m.chain ?? []) if (chain >= from) extra = rolls;
  return extra;
}

/** The chain length past which the chain gives nothing more (the last tier's start). */
export function chainCap(m: Method): number {
  const c = m.chain;
  return c?.length ? c[c.length - 1][0] : 0;
}

/** A choice's option as chosen, or its default. */
export function choiceValue(c: Choice, input: OddsInput): { id: string; rolls: number } {
  return c.options.find((o) => o.id === input.choices[c.id]) ?? c.options[0];
}

/** How many shiny rolls one encounter makes (0 for a flat-chance method). */
export function totalRolls(m: Method, input: OddsInput): number {
  if (m.flat) return 0;
  let n = m.rolls;
  if (input.charm && m.charm) n += m.charm;
  if (input.lure && m.lure) n += m.lure;
  n += chainRolls(m, input.chain);
  for (const c of m.choices ?? []) n += choiceValue(c, input).rolls;
  return n;
}

/** The chance a single encounter is shiny. */
export function shinyChance(gameId: GameId, methodId: MethodId, input: OddsInput): number {
  const game = BY_ID.get(gameId);
  const m = game?.methods.find((x) => x.id === methodId);
  if (!game || !m) return 1 / 4096;
  if (m.flat) return 1 / (input.charm && m.flat.charmOneIn ? m.flat.charmOneIn : m.flat.oneIn);
  return rollsChance(game.base, totalRolls(m, input));
}

/** 1 − (1 − 1/base)^rolls, accurately for small chances. */
export function rollsChance(base: number, rolls: number): number {
  return -Math.expm1(rolls * Math.log1p(-1 / base));
}

/** Whether the Shiny Charm changes this method's odds. */
export function charmApplies(m: Method): boolean {
  return !!m.charm || !!m.flat?.charmOneIn;
}

/** The newest game first, for pickers. */
export const GAMES_NEWEST_FIRST: readonly Game[] = [...GAMES].reverse();
