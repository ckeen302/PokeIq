import "server-only";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import * as calcLib from "@smogon/calc/dist/adaptable";
import type { AssumedSet } from "@/lib/battle/analysis/assume";
import { parseReplay } from "@/lib/battle/analysis/parse";
import { maxHpOf, rollPlacer } from "@/lib/battle/analysis/rolls";
import { computeStats } from "@/lib/battle/analysis/stats";
import { STATS_VERSION, type BattleStats } from "@/lib/battle/analysis/stats-types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import type { ReplayData } from "@/lib/battle/replay";
import { assumeSets } from "./analysis-sets";

/**
 * A finished battle's stats, worked out on the server from its saved log
 * (never while it's being played) and kept per replay: a replay never
 * changes, so the answer for one is the same for everyone, for good. The
 * assumed sets (as the replay analysis assumes them) give abilities and
 * items the battle didn't show, max HP and the damage calc's rolls.
 */

const gens = new Generations(Dex);
const MAX_CACHED = 300;
const cache = new Map<string, Promise<BattleStats>>();

const doubles = (format: string) => PLAY_FORMAT_INFO[format as keyof typeof PLAY_FORMAT_INFO]?.gameType === "doubles";

async function assumed(replay: ReplayData): Promise<Map<string, AssumedSet>> {
  try {
    const parsed = parseReplay(replay.log);
    const mons = [...parsed.revealed[0].values(), ...parsed.revealed[1].values()];
    return new Map((await assumeSets(replay.format, mons)).map((a) => [a.key, a]));
  } catch {
    return new Map();
  }
}

export async function computeBattleStats(replay: Pick<ReplayData, "format" | "log">): Promise<BattleStats> {
  const sets = await assumed(replay as ReplayData);
  const gen = gens.get(Number(/^gen(\d)/.exec(replay.format)?.[1] ?? 9));
  const calc = { gen, lib: calcLib };
  const hints = new Map([...sets].map(([k, a]) => [k, { ability: a.set.ability, item: a.set.item }]));
  return computeStats(replay.log, {
    hints,
    placeRoll: doubles(replay.format) ? undefined : rollPlacer(calc, sets),
    maxHp: (key) => maxHpOf(calc, sets.get(key)),
  });
}

/** The stats for a replay, worked out once per server and kept (the most recent few hundred). */
export function battleStats(replay: ReplayData): Promise<BattleStats> {
  const key = `${STATS_VERSION}:${replay.id}`;
  let hit = cache.get(key);
  if (hit) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  hit = computeBattleStats(replay);
  cache.set(key, hit);
  hit.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return hit;
}
