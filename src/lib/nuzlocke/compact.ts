import type { NuzEncounter } from "./model";

/**
 * An area's encounters as the screens show them: one entry per Pokémon, way of meeting it and version, its lines
 * summed up. The data has a line for each condition a Pokémon is met in (Sword & Shield's Wild Area repeats each one
 * for every weather, before and after the Hall of Fame), which is thousands of lines for one area; a player picking
 * what they met needs the Pokémon once, with its conditions in a few words.
 *
 * A Pokémon with a few plain lines keeps them ("1F 69%", "B1F 20%"); otherwise its lines become one entry: what they
 * share (`condition`), what varies (`when`: the weathers, the times of day, the floors…), the rate from `rateMin` to
 * `rate` and the levels across them.
 */

export interface CompactEncounter extends NuzEncounter {
  /** What varies between the lines summed up here: "Overcast", "Rain"…, or "Any weather"; "Night"; "1F"… */
  when?: string[];
  /** The lowest of the lines' rates, when they differ (`rate` is then the highest). */
  rateMin?: number;
}

/** Sword & Shield's weather, as the data words it; a line without one, in an area that has weather, is in normal weather. */
const WEATHER: Record<string, string> = {
  "During intense sun": "Intense sun",
  "During overcast weather": "Overcast",
  "During rainy weather": "Rain",
  Raining: "Rain",
  "During a thunderstorm": "Thunderstorm",
  "During snowy weather": "Snow",
  "During a snowstorm": "Snowstorm",
  "During a sandstorm": "Sandstorm",
  "During foggy weather": "Fog",
};
export const NORMAL_WEATHER = "Normal weather";
export const ANY_WEATHER = "Any weather";
const WEATHER_ORDER = [NORMAL_WEATHER, "Overcast", "Rain", "Thunderstorm", "Snow", "Snowstorm", "Sandstorm", "Intense sun", "Fog"];

const TIMES = ["Morning", "Day", "Night"];
const timesOf = (part: string): string[] | null => {
  const t = part.split(", ");
  return t.every((x) => TIMES.includes(x)) ? t : null;
};

/** Pairs of conditions that between them mean "any time": a Pokémon met under both is met under neither. */
const STAGES: [string, string][] = [
  ["Before entering the Hall of Fame", "Enter the Hall of Fame"],
  ["Before National Pokédex", "Acquired National Pokédex"],
];

/** A clearer wording of a condition, said the same way. */
const RELABEL: Record<string, string> = {
  "Enter the Hall of Fame": "After the Hall of Fame",
  "Before entering the Hall of Fame": "Before the Hall of Fame",
};
/** DPPt's honey trees, as the data words them: "Honey Tree Group A (70% on normal trees / 20% on Munchlax trees)". */
const HONEY = /^Honey Tree Group ([A-Z]) \((\d+)% on normal trees \/ (\d+)% on Munchlax trees\)$/;

/**
 * A condition as the screens show it, saying the same in fewer words: "After the Hall of Fame"; a honey tree's group as
 * "Group A (70% normal / 20% Munchlax trees)" under a Honey Tree heading ("Honey tree group A (…)" under any other).
 */
const label = (part: string, method: string): string => {
  const honey = HONEY.exec(part);
  if (honey) return `${/honey/i.test(method) ? "Group" : "Honey tree group"} ${honey[1]} (${honey[2]}% normal / ${honey[3]}% Munchlax trees)`;
  return RELABEL[part] ?? part;
};

const parts = (condition: string | undefined): string[] => (condition ? condition.split("; ").filter(Boolean) : []);
const weatherOf = (e: NuzEncounter): string => parts(e.condition).map((p) => WEATHER[p]).find(Boolean) ?? NORMAL_WEATHER;

/** Up to this many plain lines (no weather) stay as they are: "1F 69% · B1F 20%" says more than a range. */
const KEEP = 3;

export function compactEncounters(encounters: readonly NuzEncounter[], versions: readonly string[]): CompactEncounter[] {
  // The weathers of each way of meeting that has any (the Wild Area's grass does; its fishing and berry trees don't).
  const weathers = new Map<string, Set<string>>();
  for (const e of encounters) if (parts(e.condition).some((p) => p in WEATHER)) weathers.set(e.method, new Set());
  for (const e of encounters) weathers.get(e.method)?.add(weatherOf(e));
  const rows = new Map<string, NuzEncounter[]>();
  for (const e of encounters) {
    const key = `${e.species}|${e.form ?? ""}|${e.kind}|${e.method}`;
    const lines = rows.get(key);
    if (lines) lines.push(e);
    else rows.set(key, [e]);
  }
  const out: CompactEncounter[] = [];
  for (const lines of rows.values()) {
    const methodWeathers = weathers.get(lines[0].method) ?? null;
    if (!methodWeathers && lines.length <= KEEP) {
      for (const e of lines) out.push(e.condition ? { ...e, condition: parts(e.condition).map((p) => label(p, e.method)).join("; ") } : e);
      continue;
    }
    // Summed up version by version (a run is in one), then shared where the versions agree: in a run, a Pokémon shows
    // once per way of meeting it.
    const byResult = new Map<string, { entry: CompactEncounter; versions: string[] }>();
    for (const v of versions) {
      const mine = lines.filter((e) => !e.versions || e.versions.includes(v));
      if (!mine.length) continue;
      const entry = merge(mine, methodWeathers);
      const key = JSON.stringify(entry);
      const seen = byResult.get(key);
      if (seen) seen.versions.push(v);
      else byResult.set(key, { entry, versions: [v] });
    }
    for (const { entry, versions: vs } of byResult.values()) out.push(vs.length === versions.length ? entry : { ...entry, versions: vs });
  }
  return out;
}

function merge(lines: NuzEncounter[], methodWeathers: Set<string> | null): CompactEncounter {
  const out: CompactEncounter = { ...lines[0] };
  delete out.condition;
  delete out.rate;
  delete out.levels;
  delete out.versions;
  const each = lines.map((e) => parts(e.condition).filter((p) => !(p in WEATHER)));
  const when: string[] = [];

  // The weather: each one it's met in; "Any weather" when that's every one the area has for this way of meeting it, or
  // "Any weather but Overcast and Fog" when only one or two are missing from many.
  if (methodWeathers) {
    const seen = new Set(lines.map(weatherOf));
    const missing = WEATHER_ORDER.filter((w) => methodWeathers.has(w) && !seen.has(w));
    if (!missing.length) when.push(ANY_WEATHER);
    else if (missing.length <= 2 && seen.size >= 4) when.push(`${ANY_WEATHER} but ${missing.join(" and ")}`);
    else when.push(...WEATHER_ORDER.filter((w) => seen.has(w)));
  }

  // Before and after a point in the story: both, and it's either.
  for (const [a, b] of STAGES) {
    const has = (p: string[], x: string) => p.includes(x);
    if (each.some((p) => has(p, a)) && each.some((p) => has(p, b)) && each.every((p) => has(p, a) || has(p, b)))
      each.forEach((p, i) => (each[i] = p.filter((x) => x !== a && x !== b)));
  }

  // The time of day: left out when the lines cover the whole day.
  const times = each.map((p) => p.find((x) => timesOf(x)));
  const allDay = times.some((x) => !x) || new Set(times.flatMap((x) => timesOf(x!)!)).size === TIMES.length;
  const timeUnion = allDay ? null : TIMES.filter((x) => times.some((y) => timesOf(y!)!.includes(x)));
  each.forEach((p, i) => (each[i] = p.filter((x) => !timesOf(x))));

  // What every line says goes in `condition`; what only some do, in `when`.
  const common = each[0].filter((x) => each.every((p) => p.includes(x)));
  const said = (x: string) => label(x, lines[0].method);
  const rest = [...new Set(each.map((p) => p.filter((x) => !common.includes(x)).map(said).join("; ")).filter(Boolean))];
  if (timeUnion) when.push(timeUnion.join(", "));
  when.push(...rest);

  const rates = lines.flatMap((e) => (e.rate !== undefined ? [e.rate] : []));
  const levels = lines.flatMap((e) => (e.levels ? [e.levels] : []));
  if (common.length) out.condition = common.map(said).join("; ");
  if (when.length) out.when = when;
  if (rates.length) {
    out.rate = Math.max(...rates);
    const min = Math.min(...rates);
    if (min !== out.rate) out.rateMin = min;
  }
  if (levels.length) out.levels = [Math.min(...levels.map((l) => l[0])), Math.max(...levels.map((l) => l[1]))];
  return out;
}
