import "server-only";
import { Dex, Teams } from "pokemon-showdown";
import { fillSet, standinKey, type AssumedSet } from "@/lib/battle/analysis/assume";
import type { Revealed } from "@/lib/battle/analysis/parse";
import { completeSet, type TeamSet } from "@/lib/battle/sets";
import { findUsage, isUsageFormat, loadUsage, popularSets, type UsageFormat } from "@/lib/battle/usage";

/**
 * The replay analysis's assumptions about sets the battle didn't fully
 * show. Random formats: Showdown's own random-battle generator for the
 * format (several sets drawn per species, the one agreeing most with what
 * was revealed). Every other format: the most common sets from the
 * format's usage statistics (the generation's OU when the format has
 * none), then the generation's random-battle sets as a last resort.
 */

type Generator = { randomSet: (species: string, ...rest: unknown[]) => Partial<TeamSet> & { species?: string } };

const genOf = (format: string) => Number(/^gen(\d)/.exec(format)?.[1] ?? 9);

function randomFormatFor(format: string): string | null {
  if (/randombattle|randomdoublesbattle/.test(format)) return format;
  return null;
}

function usageFormatFor(format: string): UsageFormat | null {
  if (isUsageFormat(format)) return format;
  const ou = `gen${genOf(format)}ou`;
  return isUsageFormat(ou) ? ou : null;
}

/** A generator seeded by format and species, so the same replay always gets the same assumed sets. */
function generator(format: string, species: string): Generator | null {
  try {
    return Teams.getGenerator(format, seedOf(`${format}:${species}`) as never) as unknown as Generator;
  } catch {
    return null;
  }
}

const randomCache = new Map<string, TeamSet[]>();
/** Up to 16 distinct sets Showdown's generator gives `species` in `format`. */
function randomCandidates(format: string, species: string): TeamSet[] {
  const key = `${format}:${species}`;
  const cached = randomCache.get(key);
  if (cached) return cached;
  const gen = generator(format, species);
  const out: TeamSet[] = [];
  const seen = new Set<string>();
  const doubles = format.includes("doubles");
  for (let i = 0; gen && i < 24 && out.length < 16; i++) {
    try {
      const raw = gen.randomSet(species, {}, i % 4 === 0, doubles);
      if (!raw?.moves?.length) continue;
      const set = completeSet({ ...raw, species: raw.species ?? species, moves: raw.moves.map((m) => Dex.moves.get(m).name || m) } as never);
      const id = JSON.stringify([set.moves.slice().sort(), set.item, set.ability, set.teraType]);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(set);
      }
    } catch {
      break;
    }
  }
  if (randomCache.size > 2_000) randomCache.clear();
  randomCache.set(key, out);
  return out;
}

/** A small stable hash of a string into a simulator seed. */
function seedOf(text: string): [number, number, number, number] {
  const out: [number, number, number, number] = [0x1234, 0x5678, 0x9abc, 0xdef0];
  for (let i = 0; i < text.length; i++) out[i % 4] = (out[i % 4] * 31 + text.charCodeAt(i)) & 0xffff;
  return out;
}

/**
 * Stand-ins for Pokémon a side brought but never showed: random formats
 * draw them the way the format does (Showdown's team generator, seeded by
 * the replay so the analysis is repeatable); other formats take the most
 * used Pokémon the side doesn't have. Labelled as stand-ins.
 */
export async function standins(format: string, side: 0 | 1, count: number, have: string[], seed: string): Promise<AssumedSet[]> {
  if (count <= 0) return [];
  const gen = genOf(format);
  const dex = Dex.forGen(gen);
  const taken = new Set(have.map((s) => dex.species.get(s).baseSpecies));
  const out: TeamSet[] = [];
  const random = randomFormatFor(format) ?? (usageFormatFor(format) ? null : `gen${gen}randombattle`);
  if (random) {
    for (let round = 0; round < 4 && out.length < count; round++) {
      let team: Partial<TeamSet>[] = [];
      try {
        team = Teams.generate(random, { seed: seedOf(`${seed}:${side}:${round}`) } as never) as unknown as Partial<TeamSet>[];
      } catch {
        break;
      }
      for (const raw of team) {
        const base = dex.species.get(raw.species ?? "").baseSpecies;
        if (out.length >= count || !raw.species || taken.has(base)) continue;
        taken.add(base);
        out.push(completeSet({ ...raw, species: raw.species, moves: (raw.moves ?? []).map((m) => dex.moves.get(m).name || m) } as never));
      }
    }
  } else {
    const usage = await loadUsage(usageFormatFor(format)!).catch(() => null);
    const isStatus = (m: string) => dex.moves.get(m).category === "Status";
    for (const mon of usage?.pokemon ?? []) {
      if (out.length >= count) break;
      const base = dex.species.get(mon.species).baseSpecies;
      if (taken.has(base)) continue;
      const [first] = popularSets(mon, { level: 100, tera: gen >= 9, isStatus });
      if (!first) continue;
      taken.add(base);
      out.push(first.set);
    }
  }
  return out.map((set, i) => ({ key: standinKey(side, i), set, source: "standin", revealedMoves: 0 }));
}

export async function assumeSets(format: string, mons: Revealed[]): Promise<AssumedSet[]> {
  const gen = genOf(format);
  const random = randomFormatFor(format);
  const usageFormat = random ? null : usageFormatFor(format);
  const usage = usageFormat ? await loadUsage(usageFormat).catch(() => null) : null;
  const dex = Dex.forGen(gen);
  const isStatus = (m: string) => dex.moves.get(m).category === "Status";
  return mons.map((mon) => {
    const species = dex.species.get(mon.species);
    const base = species.exists ? (species.battleOnly ? (Array.isArray(species.battleOnly) ? species.battleOnly[0] : species.battleOnly) : species.name) : mon.species;
    if (random) {
      // Cosmetic formes (Florges-White) have their base species' sets.
      let candidates = randomCandidates(random, base);
      if (!candidates.length && species.exists && species.baseSpecies !== base) candidates = randomCandidates(random, species.baseSpecies).map((s) => ({ ...s, species: base }));
      if (candidates.length) return fillSet({ ...mon, species: base }, candidates, "random");
    }
    const used = usage ? findUsage(usage, base) : undefined;
    if (used) {
      const sets = popularSets(used, { level: mon.level, tera: gen >= 9, isStatus }).map((p) => p.set);
      if (sets.length) return fillSet({ ...mon, species: base }, sets, "usage");
    }
    if (!random) {
      const candidates = randomCandidates(`gen${gen}randombattle`, base).map((s) => ({ ...s, level: mon.level }));
      if (candidates.length) return fillSet({ ...mon, species: base }, candidates, "random");
    }
    return fillSet({ ...mon, species: base }, [], "random");
  });
}
