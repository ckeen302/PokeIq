import { completeSet, type StatsTable, type TeamSet } from "./sets";
import { calcStat, NATURES } from "./tooltip-calc";

/**
 * Smogon's monthly usage statistics, trimmed per format by
 * scripts/smogon-usage.ts into src/data/smogon/ (the most used Pokémon with
 * their common abilities, items, moves, spreads and Tera types). Only the
 * usage numbers are used: they're public domain, where Smogon's written sets
 * and analyses are not. The team builder's popular sets, threat list and
 * speed benchmarks, and the replay analysis's assumed sets, come from here.
 */

/** Every format with a usage file: the team builder's, and the past generations' tiers replays can be in. */
export const USAGE_FORMATS = [
  "gen9ou",
  "gen9ubers",
  "gen9uu",
  "gen9doublesou",
  "gen9nationaldex",
  "gen8ou",
  "gen8uu",
  "gen7ou",
  "gen7uu",
  "gen6ou",
  "gen6uu",
  "gen5ou",
  "gen5uu",
  "gen4ou",
  "gen4uu",
  "gen3ou",
  "gen3uu",
  "gen2ou",
  "gen2uu",
  "gen1ou",
  "gen1uu",
] as const;
export type UsageFormat = (typeof USAGE_FORMATS)[number];
export const isUsageFormat = (id: unknown): id is UsageFormat => typeof id === "string" && (USAGE_FORMATS as readonly string[]).includes(id);

/** [name, share of this Pokémon's sets, 0 to 1]. */
export type Share = [string, number];

export interface UsageMon {
  species: string;
  /** Share of teams (weighted), 0 to 1. */
  usage: number;
  abilities: Share[];
  items: Share[];
  moves: Share[];
  /** "Jolly:0/252/4/0/0/252" (HP/Atk/Def/SpA/SpD/Spe). */
  spreads: Share[];
  teraTypes: Share[];
}

export interface UsageFile {
  format: UsageFormat;
  battles: number;
  /** When the numbers were downloaded (YYYY-MM-DD). */
  fetched: string;
  /** Most used first. */
  pokemon: UsageMon[];
}

export const USAGE_SOURCE = "Smogon usage statistics (via data.pkmn.cc)";

const LOADERS: Record<UsageFormat, () => Promise<{ default: unknown }>> = {
  gen9ou: () => import("@/data/smogon/gen9ou.json"),
  gen9ubers: () => import("@/data/smogon/gen9ubers.json"),
  gen9uu: () => import("@/data/smogon/gen9uu.json"),
  gen9doublesou: () => import("@/data/smogon/gen9doublesou.json"),
  gen9nationaldex: () => import("@/data/smogon/gen9nationaldex.json"),
  gen8ou: () => import("@/data/smogon/gen8ou.json"),
  gen8uu: () => import("@/data/smogon/gen8uu.json"),
  gen7ou: () => import("@/data/smogon/gen7ou.json"),
  gen7uu: () => import("@/data/smogon/gen7uu.json"),
  gen6ou: () => import("@/data/smogon/gen6ou.json"),
  gen6uu: () => import("@/data/smogon/gen6uu.json"),
  gen5ou: () => import("@/data/smogon/gen5ou.json"),
  gen5uu: () => import("@/data/smogon/gen5uu.json"),
  gen4ou: () => import("@/data/smogon/gen4ou.json"),
  gen4uu: () => import("@/data/smogon/gen4uu.json"),
  gen3ou: () => import("@/data/smogon/gen3ou.json"),
  gen3uu: () => import("@/data/smogon/gen3uu.json"),
  gen2ou: () => import("@/data/smogon/gen2ou.json"),
  gen2uu: () => import("@/data/smogon/gen2uu.json"),
  gen1ou: () => import("@/data/smogon/gen1ou.json"),
  gen1uu: () => import("@/data/smogon/gen1uu.json"),
};

const loaded = new Map<UsageFormat, Promise<UsageFile>>();

/** A format's usage file (one chunk per format, loaded once). */
export function loadUsage(format: UsageFormat): Promise<UsageFile> {
  let file = loaded.get(format);
  if (!file) {
    file = LOADERS[format]().then((m) => m.default as UsageFile);
    file.catch(() => loaded.delete(format));
    loaded.set(format, file);
  }
  return file;
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function findUsage(file: UsageFile, species: string): UsageMon | undefined {
  const id = toId(species);
  return file.pokemon.find((m) => toId(m.species) === id);
}

// ---------------------------------------------------------------------------
// Spreads
// ---------------------------------------------------------------------------

const ORDER: (keyof StatsTable)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** "Jolly:0/252/4/0/0/252" → its nature and EVs; null if it isn't one. */
export function parseSpread(text: string): { nature: string; evs: StatsTable } | null {
  const m = /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(text);
  if (!m) return null;
  const evs = Object.fromEntries(ORDER.map((s, i) => [s, Math.min(252, Number(m[i + 2]))])) as StatsTable;
  return { nature: m[1], evs };
}

const STAT_SHORT: Record<keyof StatsTable, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/** "Jolly 252 Atk / 4 Def / 252 Spe". */
export function spreadLabel(nature: string, evs: StatsTable): string {
  const parts = ORDER.filter((s) => evs[s]).map((s) => `${evs[s]} ${STAT_SHORT[s]}`);
  return `${nature} ${parts.join(" / ") || "no EVs"}`;
}

export function natureMultiplier(nature: string, stat: keyof StatsTable): number {
  const n = NATURES.find(([name]) => name.toLowerCase() === nature.toLowerCase());
  if (!n || stat === "hp") return 1;
  return n[1] === stat ? 1.1 : n[2] === stat ? 0.9 : 1;
}

// ---------------------------------------------------------------------------
// Popular sets
// ---------------------------------------------------------------------------

export interface PopularSet {
  label: string;
  /** How common its spread is among this Pokémon's sets (0 to 1). */
  share: number;
  set: TeamSet;
}

/** Items that lock a Pokémon out of status moves. */
const ATTACKS_ONLY = new Set(["choiceband", "choicespecs", "choicescarf", "assaultvest"]);

/**
 * Up to three sets assembled from the usage numbers: each common spread with
 * the matching most common item, the most common ability and Tera type, and
 * the four most used moves (attacks only with a Choice item or Assault
 * Vest). These are the most common choices, not a set anyone wrote down.
 */
export function popularSets(mon: UsageMon, opts: { level: number; isStatus: (move: string) => boolean; tera: boolean }): PopularSet[] {
  const out: PopularSet[] = [];
  const spreads = mon.spreads.length ? mon.spreads : [["Serious:0/0/0/0/0/0", 1] as Share];
  spreads.slice(0, 3).forEach(([text, share], i) => {
    const spread = parseSpread(text);
    if (!spread) return;
    const item = mon.items[Math.min(i, mon.items.length - 1)]?.[0] ?? "";
    const attacksOnly = ATTACKS_ONLY.has(toId(item));
    const moves = mon.moves
      .map(([m]) => m)
      .filter((m) => !attacksOnly || !opts.isStatus(m))
      .slice(0, 4);
    const set = completeSet({
      species: mon.species,
      level: opts.level,
      ability: mon.abilities[0]?.[0] ?? "",
      item,
      nature: spread.nature,
      evs: spread.evs,
      moves,
      ...(opts.tera && mon.teraTypes[0] ? { teraType: mon.teraTypes[0][0] } : {}),
    });
    const key = JSON.stringify([set.item, set.nature, set.evs, set.moves]);
    if (out.some((o) => JSON.stringify([o.set.item, o.set.nature, o.set.evs, o.set.moves]) === key)) return;
    out.push({ label: `${item || "No item"} · ${spreadLabel(spread.nature, spread.evs)}`, share, set });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Speed benchmarks
// ---------------------------------------------------------------------------

export interface SpeedBenchmark {
  label: string;
  speed: number;
  /** Share of this Pokémon's spreads (0 to 1); for Choice Scarf, its item share. */
  share: number;
}

/** A Pokémon's speeds at its common spreads (and with Choice Scarf, when that's common). Highest first. */
export function speedBenchmarks(mon: UsageMon, baseSpe: number, level: number): SpeedBenchmark[] {
  const byLabel = new Map<string, SpeedBenchmark>();
  for (const [text, share] of mon.spreads) {
    const spread = parseSpread(text);
    if (!spread) continue;
    const mult = natureMultiplier(spread.nature, "spe");
    const speed = calcStat("spe", baseSpe, level, 31, spread.evs.spe, mult);
    const label = `${mult > 1 ? "+Spe " : mult < 1 ? "−Spe " : ""}${spread.evs.spe} EVs`;
    const prev = byLabel.get(label);
    byLabel.set(label, { label, speed, share: (prev?.share ?? 0) + share });
  }
  const scarf = mon.items.find(([i]) => toId(i) === "choicescarf");
  const out = [...byLabel.values()];
  if (scarf && scarf[1] >= 0.1 && out.length) {
    const fastest = out.reduce((a, b) => (b.speed > a.speed ? b : a));
    out.push({ label: `${fastest.label}, Choice Scarf`, speed: Math.floor(fastest.speed * 1.5), share: scarf[1] });
  }
  return out.sort((a, b) => b.speed - a.speed);
}
