/**
 * "Custom rules": a battle on Pokémon Showdown's `gen<N>customgame` with
 * Showdown's own rule strings layered on top, so every mechanic (the type
 * chart, the physical / special split, crits, gimmicks, clauses) is the
 * engine's own. Shared by the setup screen (which builds the rules) and the
 * server (which validates them with Showdown's format parser before any
 * battle starts). Nothing here imports the simulator.
 */

export const CUSTOM_GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type CustomGen = (typeof CUSTOM_GENS)[number];

export type Gimmick = "tera" | "dynamax" | "mega" | "zmoves";
export type Clause = "species" | "sleep" | "evasion" | "ohko" | "item" | "endless";

export interface CustomRules {
  gen: CustomGen;
  level: number;
  /** fixed: every Pokémon battles at `level` (Adjust Level). cap: nothing above it (Max Level). */
  levelMode: "fixed" | "cap";
  gimmicks: Record<Gimmick, boolean>;
  clauses: Record<Clause, boolean>;
  /** Pokémon each trainer brings. */
  teamSize: number;
  /** Team preview: bring `teamSize`, pick this many to battle. Null: no team preview (lead with your first). */
  pick: number | null;
  /** Live battles: the turn timer, and the most one turn may take. */
  timer: boolean;
  timerSeconds: number;
  /**
   * One of Showdown's own formats from the catalogue (format-catalogue.ts),
   * played exactly as Showdown runs it: the gen, level, clause and gimmick
   * settings above are then the format's, not these. Null: the Custom Game.
   */
  base?: string | null;
  /** The base format's name (the server sets it from the catalogue). */
  baseName?: string;
  /** The base format deals random teams. */
  baseRandom?: boolean;
}

/** The generations each gimmick exists in (Showdown's own data agrees: a test checks). */
export const GIMMICK_GENS: Record<Gimmick, readonly number[]> = {
  mega: [6, 7],
  zmoves: [7],
  dynamax: [8],
  tera: [9],
};

export const GIMMICK_INFO: Record<Gimmick, { name: string; rule: string }> = {
  tera: { name: "Terastal", rule: "Terastal Clause" },
  dynamax: { name: "Dynamax", rule: "Dynamax Clause" },
  mega: { name: "Mega Evolution", rule: "-Mega" },
  zmoves: { name: "Z-Moves", rule: "Z-Move Clause" },
};

export const CLAUSE_INFO: Record<Clause, { name: string; rule: string; blurb: string }> = {
  species: { name: "Species Clause", rule: "Species Clause", blurb: "No two of the same Pokémon." },
  sleep: { name: "Sleep Clause", rule: "Sleep Clause Mod", blurb: "Only one foe asleep at a time." },
  evasion: { name: "Evasion Clause", rule: "Evasion Clause", blurb: "No evasion-boosting moves, items or abilities." },
  ohko: { name: "OHKO Clause", rule: "OHKO Clause", blurb: "No one-hit KO moves." },
  item: { name: "Item Clause", rule: "Item Clause = 1", blurb: "No two Pokémon holding the same item." },
  endless: { name: "Endless Battle Clause", rule: "Endless Battle Clause", blurb: "No battles that can't end." },
};

export const GIMMICKS = Object.keys(GIMMICK_INFO) as Gimmick[];
export const CLAUSES = Object.keys(CLAUSE_INFO) as Clause[];

/** Gens whose Custom Game already has Team Preview (Showdown's own rulesets; a test checks). */
const PREVIEW_GENS = new Set([5, 6, 7, 8, 9]);

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 100;
export const TIMER_MIN = 20;
export const TIMER_MAX = 300;

export const DEFAULT_CUSTOM_RULES: CustomRules = {
  gen: 9,
  level: 100,
  levelMode: "fixed",
  gimmicks: { tera: true, dynamax: true, mega: true, zmoves: true },
  clauses: { species: true, sleep: true, evasion: true, ohko: true, item: false, endless: true },
  teamSize: 6,
  pick: null,
  timer: true,
  timerSeconds: 90,
};

export const gimmickAllowed = (g: Gimmick, gen: number) => GIMMICK_GENS[g].includes(gen);

const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Any input (a request body, an old saved ruleset) made into a well-formed ruleset. */
export function normalizeRules(raw: unknown): CustomRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CustomRules>;
  const d = DEFAULT_CUSTOM_RULES;
  const gen = int(r.gen, 1, 9, d.gen) as CustomGen;
  const teamSize = int(r.teamSize, 1, 6, d.teamSize);
  const pick = r.pick === null || r.pick === undefined ? null : int(r.pick, 1, teamSize, Math.min(3, teamSize));
  const flags = <K extends string>(keys: K[], from: unknown, fallback: Record<K, boolean>) =>
    Object.fromEntries(keys.map((k) => [k, typeof (from as Record<K, unknown>)?.[k] === "boolean" ? (from as Record<K, boolean>)[k] : fallback[k]])) as Record<K, boolean>;
  return {
    gen,
    level: int(r.level, LEVEL_MIN, LEVEL_MAX, d.level),
    levelMode: r.levelMode === "cap" ? "cap" : "fixed",
    gimmicks: flags(GIMMICKS, r.gimmicks, d.gimmicks),
    clauses: flags(CLAUSES, r.clauses, d.clauses),
    teamSize,
    pick,
    timer: typeof r.timer === "boolean" ? r.timer : d.timer,
    timerSeconds: int(r.timerSeconds, TIMER_MIN, TIMER_MAX, d.timerSeconds),
    ...(typeof r.base === "string" && /^[a-z0-9]{3,80}$/.test(r.base)
      ? { base: r.base, baseName: typeof r.baseName === "string" ? r.baseName.slice(0, 80) : r.base, baseRandom: r.baseRandom === true }
      : {}),
  };
}

/** Showdown's rule strings for a ruleset, on top of `gen<N>customgame`. */
export function ruleStrings(rules: CustomRules): string[] {
  const out = ["Obtainable"];
  if (rules.levelMode === "fixed") out.push(`Adjust Level = ${rules.level}`);
  else out.push(`!! Max Level = ${rules.level}`, `!! Default Level = ${rules.level}`);
  for (const g of GIMMICKS) if (gimmickAllowed(g, rules.gen) && !rules.gimmicks[g]) out.push(GIMMICK_INFO[g].rule);
  for (const c of CLAUSES) if (rules.clauses[c]) out.push(CLAUSE_INFO[c].rule);
  out.push(`!! Max Team Size = ${rules.teamSize}`);
  const preview = PREVIEW_GENS.has(rules.gen);
  if (rules.pick !== null) {
    if (!preview) out.push("Team Preview");
    if (rules.pick < rules.teamSize) out.push(`Picked Team Size = ${rules.pick}`);
  } else if (preview) {
    out.push("!Team Preview");
  }
  return out;
}

/** The Showdown format id: `gen4customgame@@@Obtainable,Adjust Level = 50,...`. */
export const customFormatId = (rules: CustomRules) => rules.base ?? `gen${rules.gen}customgame@@@${ruleStrings(rules).join(",")}`;

/** The ruleset as players read it, one line each. */
export function describeRules(rules: CustomRules): { label: string; text: string }[] {
  if (rules.base) return [{ label: "Format", text: `${rules.baseName ?? rules.base}, on Showdown's own rules${rules.baseRandom ? " with random teams" : ""}` }];
  const gimmicks = GIMMICKS.filter((g) => gimmickAllowed(g, rules.gen));
  const clauses = CLAUSES.filter((c) => rules.clauses[c]).map((c) => CLAUSE_INFO[c].name);
  const out = [
    { label: "Mechanics", text: `Generation ${rules.gen}` },
    { label: "Level", text: rules.levelMode === "fixed" ? `Every Pokémon at level ${rules.level}` : `Level ${rules.level} at most` },
    {
      label: "Teams",
      text: rules.pick !== null ? `Bring ${rules.teamSize}, pick ${rules.pick} (team preview)` : `${rules.teamSize} Pokémon each`,
    },
    { label: "Clauses", text: clauses.length ? clauses.join(", ") : "None" },
  ];
  if (gimmicks.length) out.push({ label: "Gimmicks", text: gimmicks.map((g) => `${GIMMICK_INFO[g].name} ${rules.gimmicks[g] ? "on" : "off"}`).join(", ") });
  return out;
}

/** A short name: "Gen 4 Custom · Lv 50". */
export const customName = (rules: CustomRules) => (rules.base ? (rules.baseName ?? rules.base) : `[Gen ${rules.gen}] Custom · Lv ${rules.levelMode === "cap" ? "≤" : ""}${rules.level}`);

/** The turn timer a ruleset sets for live battles; null with the timer off. */
export function customTimer(rules: CustomRules): { bank: number; perTurn: number; cap: number } | null {
  if (!rules.timer) return null;
  const cap = rules.timerSeconds * 1000;
  return { bank: Math.max(cap, 150_000), perTurn: 10_000, cap };
}

/** The team builder format whose saved teams fit a gen (null: none, so a quick team or an import). */
export function builderFormatFor(gen: number): "gen9ou" | "gen4ou" | "gen3ou" | null {
  return gen === 9 ? "gen9ou" : gen === 4 ? "gen4ou" : gen === 3 ? "gen3ou" : null;
}

// ---------------------------------------------------------------------------
// The last ruleset, remembered on this device
// ---------------------------------------------------------------------------

const RULES_KEY = "pokeiq:battle:custom-rules";

export function lastCustomRules(): CustomRules {
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? normalizeRules(JSON.parse(raw)) : DEFAULT_CUSTOM_RULES;
  } catch {
    return DEFAULT_CUSTOM_RULES;
  }
}

export function rememberCustomRules(rules: CustomRules) {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // remembered for this visit only
  }
}
