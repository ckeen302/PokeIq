/**
 * Encounter rates in one shape for all three sources, so they can be compared: per (version, Pokémon, method family)
 * a vector of chances by time of day (Gen 2/4), season (Gen 5) or a single slot, summed over the place's parts.
 */
import type { BulbaRow } from "./bulba-catch";
import type { Row } from "./rows";

/**
 * The method families whose rates are compared (each source names them its own way): walking (grass, cave, a
 * building's floor…), surfing and each rod. Anything else (rustling grass, headbutt, hordes, dark grass…) returns null
 * and is checked by species only.
 */
export function famOf(method: string): string | null {
  const m = method.toLowerCase().trim();
  if (/^(fish old|old rod)$/.test(m)) return "old rod";
  if (/^(fish good|good rod)$/.test(m)) return "good rod";
  if (/^(fish super|super rod|fishing|fish)$/.test(m)) return "super rod";
  if (/^(surf|surfing)$/.test(m)) return "surf";
  if (/^(grass|cave|walking|building|tall grass|long grass|deep sand|sand|snow|puddle|brown grass|swamp|terrain|basement|lowest floor|entrance|inside)$/.test(m)) return "walk";
  if (/^(b?\d+f)(-b?\d+f)?$/.test(m)) return "walk";
  return null;
}

const pct = (s: string) => {
  const t = s.trim();
  if (!t || t === "-" || t === "—") return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%?/);
  return m ? Number(m[1]) : NaN;
};

/** A game's time slots, as our rows' conditions name them: Gen 2/4's times of day, Gen 5's seasons, Alola's day and night. */
export function slotNames(game: string): string[] {
  if (["gold-silver", "crystal", "diamond-pearl", "platinum", "heartgold-soulsilver"].includes(game)) return ["Morning", "Day", "Night"];
  if (["black-white", "black-2-white-2"].includes(game)) return ["Spring", "Summer", "Autumn", "Winter"];
  if (["sun-moon", "ultra-sun-ultra-moon"].includes(game)) return ["Day", "Night"];
  return [];
}

/** Our row's chance per slot, from its condition's time or season words; null when it has another condition. */
export function vecOurs(r: Row, names: string[]): number[] | null {
  if (r.rate === undefined) return null;
  const n = Math.max(1, names.length);
  const parts = (r.cond ?? "").split("; ").filter(Boolean);
  const slotPart = names.length ? parts.find((p) => p.split(", ").every((w) => names.includes(w))) : undefined;
  if (parts.length > (slotPart ? 1 : 0)) return null;
  if (!slotPart) return Array(n).fill(r.rate);
  const on = slotPart.split(", ");
  return names.map((w) => (on.includes(w) ? r.rate! : 0));
}

/** Bulbapedia row's chance per slot (n slots); null when it can't be read as rates. */
export function vecBulba(r: BulbaRow, n: number): number[] | null {
  if (!r.rate) return null;
  const vals = r.rate.split("/").map(pct);
  if (vals.some((v) => Number.isNaN(v))) return null;
  if (vals.length === 1) return Array(n).fill(vals[0]);
  if (vals.length === n) return vals;
  if (n === 1 && vals.every((v) => v === vals[0])) return [vals[0]];
  return null;
}

export function addVec(into: Map<string, number[]>, key: string, v: number[]) {
  const cur = into.get(key);
  if (!cur) into.set(key, [...v]);
  else v.forEach((x, i) => (cur[i] += x));
}

/** Equal within rounding (Gen 1-2 chances are fractions of 256: PokéAPI and Bulbapedia round them differently). */
export const sameVec = (a: number[] | undefined, b: number[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= Math.max(1.5, 0.05 * Math.max(x, b[i])));
