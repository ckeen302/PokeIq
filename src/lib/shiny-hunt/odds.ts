/**
 * Shiny odds for the Shiny Hunt Counter: every game and method it offers, and the chance one encounter is shiny.
 *
 * How the games work: each encounter makes one or more independent shiny checks ("rolls") at the base rate (1/8192 in
 * Generations 2–5, 1/4096 from X and Y on); the Shiny Charm, the Masuda method, chains and outbreaks add rolls. So
 * P(shiny) = 1 − (1 − 1/base)^rolls. A few methods work differently and are worked out by `curveChance` from the
 * games' own formulas (the Poké Radar, the DexNav, Ultra Wormholes), and a few are a flat chance (Gen 2 breeding with a
 * shiny parent, Dynamax Adventures).
 *
 * Every figure is checked against at least two independent sources; the tests (tests/shiny-hunt.test.ts) cite them
 * method by method. The main ones:
 *  - the pret decompilations: pokecrystal (engine/gfx/color.asm CheckShininess, engine/events/daycare.asm egg DVs),
 *    pokeemerald (SHINY_ODDS 8 of 65536), pokeplatinum (src/pokeradar.c CheckPatchShiny, src/overlay005/daycare.c
 *    Masuda rerolls) and pokeheartgold (src/get_egg.c Masuda rerolls);
 *  - wwwwwwzx/3DSRNGTool (Gen 6–7 PID rolls: Friend Safari, chain fishing, Poké Radar, DexNav, SOS, eggs);
 *  - Admiral-Fish/PokeFinder (Gen 5 Shiny Charm, BDSP eggs, wild and Grand Underground) and kwsch/PKHeX (Legends:
 *    Arceus research rolls, Legends: Z-A charm and Hyperspace rolls);
 *  - Bulbapedia ("Shiny Pokémon", "Poké Radar", "DexNav", "Friend Safari", "Shiny Charm", "Masuda method",
 *    "Pokémon breeding", "Brilliant Pokémon") and Serebii's per-game shiny pages, which tabulate the datamined figures
 *    (most of them from Anubis/Kaphotics, SciresM and wwwwwwzx).
 */

export type GameId = "gsc" | "rse" | "frlg" | "dppt" | "hgss" | "bw" | "b2w2" | "xy" | "oras" | "sm" | "usum" | "lgpe" | "swsh" | "bdsp" | "pla" | "sv" | "za";

export type MethodId =
  | "wild"
  | "eggs"
  | "breeding"
  | "masuda"
  | "pokeRadar"
  | "friendSafari"
  | "chainFishing"
  | "horde"
  | "dexNav"
  | "sos"
  | "wormhole"
  | "catchCombo"
  | "brilliant"
  | "dynamax"
  | "underground"
  | "outbreak"
  | "massiveOutbreak"
  | "hyperspace";

/** A choice that sets the odds (Legends: Arceus research level, Sparkling Power, outbreak KOs, number battled, wormhole rings). */
export type ChoiceId = "research" | "sparkling" | "cleared" | "battled" | "rings";

export interface Choice {
  id: ChoiceId;
  /** Each option's id and the rolls it adds; the first is the default. */
  options: readonly { id: string; rolls: number }[];
}

/** Odds worked out by a game's own formula rather than by counting rolls. */
export type CurveId = "radarDppt" | "radarXy" | "radarBdsp" | "dexNav" | "wormhole";

/** A second number the odds depend on: the DexNav's Search Level, or the Ultra Warp Ride's distance. */
export interface LevelInput {
  id: "searchLevel" | "distance";
  max: number;
  /** What − and + change it by. */
  step: number;
}

export interface Method {
  id: MethodId;
  /** Rolls per encounter before any bonus (1; 5 or 6 for the Masuda method; 5 in the Friend Safari). */
  rolls: number;
  /** Rolls the Shiny Charm adds; absent where the charm doesn't apply. */
  charm?: number;
  /** Rolls a toggled bonus adds: a Lure (Let's Go) or the Grand Underground's Diglett bonus. */
  lure?: number;
  /** What that toggle is. */
  lureKind?: "lure" | "diglett";
  /** A chain's extra rolls: [chain length from which the tier applies, rolls it adds], ascending. */
  chain?: readonly (readonly [number, number])[];
  /** The odds come from a formula (and a chain input, except for wormholes). */
  curve?: CurveId;
  /** For a curve with a chain: the chain length past which the odds stop changing. */
  curveCap?: number;
  /** The longest chain the game keeps (Sun and Moon's SOS counter rolls over after 255). */
  chainMax?: number;
  level?: LevelInput;
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
/** Sword/Shield: Brilliant Pokémon get 1–6 bonus rolls by the species' Number Battled. */
const BATTLED: Choice = {
  id: "battled",
  options: [
    { id: "1", rolls: 1 },
    { id: "50", rolls: 2 },
    { id: "100", rolls: 3 },
    { id: "200", rolls: 4 },
    { id: "300", rolls: 5 },
    { id: "500", rolls: 6 },
  ],
};
/** Ultra Sun/Ultra Moon: how many rings the wormhole has (its rarity). */
const RINGS: Choice = { id: "rings", options: [{ id: "0", rolls: 0 }, { id: "1", rolls: 0 }, { id: "2", rolls: 0 }, { id: "3", rolls: 0 }] };

/** Chain fishing (X/Y, Omega Ruby/Alpha Sapphire): two extra rolls per Pokémon hooked in a row, up to 20. */
const FISHING_CHAIN: readonly (readonly [number, number])[] = Array.from({ length: 20 }, (_, i) => [i + 1, 2 * (i + 1)] as const);
/** SOS chains: four more rolls at 11, 21 and 31 calls in a row. */
const SOS_CHAIN: readonly (readonly [number, number])[] = [[11, 4], [21, 8], [31, 12]];

const wild = (charm?: number): Method => ({ id: "wild", rolls: 1, ...(charm && { charm }) });
const masuda = (rolls: number, charm?: number): Method => ({ id: "masuda", rolls, ...(charm && { charm }) });
/**
 * Eggs from parents of one language. From X and Y on the Shiny Charm doesn't add to an egg's own personality value:
 * with the charm the game rolls only its two extra values, so the charm alone gives 2 rolls, not 3.
 */
const eggs = (charm?: number): Method => ({ id: "eggs", rolls: 1, ...(charm && { charm }) });
const radar = (curve: CurveId): Method => ({ id: "pokeRadar", rolls: 1, curve, curveCap: 40 });

export const GAMES: readonly Game[] = [
  { id: "gsc", gen: 2, base: 8192, methods: [wild(), { id: "breeding", rolls: 1, flat: { oneIn: 64 } }] },
  { id: "rse", gen: 3, base: 8192, methods: [wild(), eggs()] },
  { id: "frlg", gen: 3, base: 8192, methods: [wild(), eggs()] },
  { id: "dppt", gen: 4, base: 8192, methods: [wild(), eggs(), masuda(5), radar("radarDppt")] },
  { id: "hgss", gen: 4, base: 8192, methods: [wild(), eggs(), masuda(5)] },
  { id: "bw", gen: 5, base: 8192, methods: [wild(), eggs(), masuda(6)] },
  { id: "b2w2", gen: 5, base: 8192, methods: [wild(2), eggs(2), masuda(6, 2)] },
  {
    id: "xy",
    gen: 6,
    base: 4096,
    methods: [
      wild(2),
      eggs(1),
      masuda(6, 2),
      radar("radarXy"),
      { id: "friendSafari", rolls: 5, charm: 2 },
      { id: "chainFishing", rolls: 1, charm: 2, chain: FISHING_CHAIN },
      { id: "horde", rolls: 1, charm: 2, step: 5 },
    ],
  },
  {
    id: "oras",
    gen: 6,
    base: 4096,
    methods: [
      wild(2),
      eggs(1),
      masuda(6, 2),
      { id: "dexNav", rolls: 1, charm: 2, curve: "dexNav", curveCap: 100, level: { id: "searchLevel", max: 999, step: 1 } },
      { id: "chainFishing", rolls: 1, charm: 2, chain: FISHING_CHAIN },
      { id: "horde", rolls: 1, charm: 2, step: 5 },
    ],
  },
  { id: "sm", gen: 7, base: 4096, methods: [wild(2), eggs(1), masuda(6, 2), { id: "sos", rolls: 1, charm: 2, chain: SOS_CHAIN, chainMax: 255 }] },
  {
    id: "usum",
    gen: 7,
    base: 4096,
    methods: [
      wild(2),
      eggs(1),
      masuda(6, 2),
      { id: "sos", rolls: 1, charm: 2, chain: SOS_CHAIN },
      { id: "wormhole", rolls: 1, curve: "wormhole", level: { id: "distance", max: 9999, step: 100 }, choices: [RINGS] },
    ],
  },
  { id: "lgpe", gen: 7, base: 4096, methods: [{ id: "catchCombo", rolls: 1, charm: 2, lure: 1, lureKind: "lure", chain: [[11, 3], [21, 7], [31, 11]] }] },
  {
    id: "swsh",
    gen: 8,
    base: 4096,
    methods: [wild(2), eggs(1), masuda(6, 2), { id: "brilliant", rolls: 1, charm: 2, choices: [BATTLED] }, { id: "dynamax", rolls: 1, flat: { oneIn: 300, charmOneIn: 100 } }],
  },
  // Brilliant Diamond/Shining Pearl: the Shiny Charm is counted for eggs only (not wild Pokémon, the Poké Radar or the
  // Grand Underground).
  {
    id: "bdsp",
    gen: 8,
    base: 4096,
    methods: [wild(), eggs(1), masuda(6, 2), radar("radarBdsp"), { id: "underground", rolls: 1, lure: 1, lureKind: "diglett" }],
  },
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
      eggs(1),
      masuda(6, 2),
    ],
  },
  { id: "za", gen: 9, base: 4096, methods: [wild(3), { id: "hyperspace", rolls: 1, charm: 3, choices: [SPARKLING] }] },
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
  /** The DexNav Search Level or the wormhole distance (0 where the method has neither). */
  level: number;
  choices: Partial<Record<ChoiceId, string>>;
}

export const NO_BONUS: OddsInput = { charm: false, lure: false, chain: 0, level: 0, choices: {} };

/** Whether the method's odds depend on a chain the hunter enters. */
export function hasChain(m: Method): boolean {
  return !!m.chain || (!!m.curve && m.curveCap !== undefined);
}

/** The extra rolls a chain of this length gives (0 below the first tier). */
export function chainRolls(m: Method, chain: number): number {
  let extra = 0;
  for (const [from, rolls] of m.chain ?? []) if (chain >= from) extra = rolls;
  return extra;
}

/** The chain length past which the chain gives nothing more (the last tier's start). */
export function chainCap(m: Method): number {
  if (m.curveCap !== undefined) return m.curveCap;
  const c = m.chain;
  return c?.length ? c[c.length - 1][0] : 0;
}

/** A choice's option as chosen, or its default. */
export function choiceValue(c: Choice, input: OddsInput): { id: string; rolls: number } {
  return c.options.find((o) => o.id === input.choices[c.id]) ?? c.options[0];
}

/** How many shiny rolls one encounter makes (0 for a flat-chance or formula method). */
export function totalRolls(m: Method, input: OddsInput): number {
  if (m.flat || m.curve) return 0;
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
  if (m.curve) return curveChance(m, game.base, input);
  return rollsChance(game.base, totalRolls(m, input));
}

/** 1 − (1 − 1/base)^rolls, accurately for small chances. */
export function rollsChance(base: number, rolls: number): number {
  return -Math.expm1(rolls * Math.log1p(-1 / base));
}

/** At least one of `n` checks of chance `q` passing: 1 − (1 − q)^n. */
const anyOf = (q: number, n: number) => (q > 0 && n > 0 ? -Math.expm1(n * Math.log1p(-q)) : 0);
const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(v) ? v : 0)));

/**
 * Brilliant Diamond/Shining Pearl's Poké Radar: 1 in N for a patch that continues the chain, by chain length 0–40
 * (40 and over: 1 in 99). Datamined by Anubis; Serebii and Bulbapedia publish the same table.
 */
export const BDSP_RADAR: readonly number[] = [
  4096, 3855, 3640, 3449, 3277, 3121, 2979, 2849, 2731, 2621, 2521, 2427, 2341, 2259, 2185, 2114, 2048, 1986, 1927, 1872, 1820, 1771, 1724, 1680, 1638, 1598, 1560, 1524, 1489, 1456, 1310, 1285, 1260, 1236,
  1213, 1192, 993, 799, 400, 200, 99,
];

/** The DexNav's shiny check passes when a random 0–9999 is below ⌈target⌉; the target grows with the Search Level. */
export function dexNavCheck(searchLevel: number): number {
  const sl = clampInt(searchLevel, 0, 999);
  const base = sl > 200 ? sl + 600 : sl > 100 ? 2 * sl + 400 : 6 * sl;
  return Math.ceil(base / 100) / 10000;
}

/** Odds from a game's own formula. */
export function curveChance(m: Method, base: number, input: OddsInput): number {
  const chain = clampInt(input.chain, 0, 9999);
  switch (m.curve) {
    case "radarDppt": {
      // pokeplatinum src/pokeradar.c CheckPatchShiny: LCRNG_RandMod(max(200, 8200 − 200 × chain)) == 0, i.e.
      // (⌊65535 / rate⌋ + 1) / 65536; a patch that fails is still generated normally, at 1/8192.
      if (chain < 1) return 1 / base;
      const rate = Math.max(200, 8200 - 200 * chain);
      const q = (Math.floor(65535 / rate) + 1) / 65536;
      return q + (1 - q) / base;
    }
    case "radarXy":
      // 3DSRNGTool Gen6/PokeRadar.cs: a sparkling patch is 1 in (8100 − 200 × chain), 1 in 100 from 40; a chained
      // patch that fails is forced not to be shiny. At 0 there's no chain yet: an ordinary encounter.
      return chain < 1 ? 1 / base : 1 / Math.max(100, 8100 - 200 * chain);
    case "radarBdsp":
      return 1 / BDSP_RADAR[Math.min(chain, BDSP_RADAR.length - 1)];
    case "dexNav": {
      // 3DSRNGTool Gen6/DexNav.cs: 1 check (+2 with the charm, +4 when boosted, +5 on the 50th of a chain, +10 on the
      // 100th). Every 5th Pokémon of a chain is boosted, and any other one 4% of the time. `chain` is the chain so far,
      // so the next Pokémon is number chain + 1. Failing that, it can still be shiny the normal way.
      const next = chain + 1;
      const q = dexNavCheck(input.level);
      const charm = input.charm && m.charm ? m.charm : 0;
      const checks = 1 + charm + (next === 50 ? 5 : next === 100 ? 10 : 0);
      const forced = next % 5 === 0 ? anyOf(q, checks + 4) : 0.96 * anyOf(q, checks) + 0.04 * anyOf(q, checks + 4);
      return forced + (1 - forced) * rollsChance(base, 1 + charm);
    }
    case "wormhole": {
      // Serebii and Bulbapedia: 1% in a ring-less wormhole; otherwise k = min(9, ⌊distance / 500⌋ − 1) gives 1 + k %
      // (1 ring), 1 + 2k % (2 rings), 4k % (3 rings). Ringed wormholes only appear from 1,000 ly, 3 rings from 2,500.
      const rings = Number(input.choices.rings ?? "0");
      const k = Math.min(9, Math.floor(clampInt(input.level, 0, 99_999) / 500) - 1);
      if (rings === 1) return (1 + Math.max(1, k)) / 100;
      if (rings === 2) return (1 + 2 * Math.max(1, k)) / 100;
      if (rings === 3) return (4 * Math.max(4, k)) / 100;
      return 0.01;
    }
  }
  return 1 / base;
}

/** Whether the Shiny Charm changes this method's odds. */
export function charmApplies(m: Method): boolean {
  return !!m.charm || !!m.flat?.charmOneIn;
}

/** The newest game first, for pickers. */
export const GAMES_NEWEST_FIRST: readonly Game[] = [...GAMES].reverse();
