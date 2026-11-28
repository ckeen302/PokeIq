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
  /** Met only after the story ("After the Hall of Fame"): kept apart from the story's lines, never summed up with them. */
  post?: string;
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
  Fog: "Fog",
};
export const NORMAL_WEATHER = "Normal weather";
export const ANY_WEATHER = "Any weather";
const WEATHER_ORDER = [NORMAL_WEATHER, "Overcast", "Rain", "Thunderstorm", "Snow", "Snowstorm", "Sandstorm", "Intense sun", "Fog"];

/** The parts of the day the data names; a game has some of them (Scarlet & Violet all four, Legends: Z-A day and night). */
const TIMES = ["Morning", "Day", "Evening", "Night"];
/** The day of the games before Legends: Arceus and Scarlet & Violet, which have no evening. */
export const DAY = ["Morning", "Day", "Night"];
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
  // Scarlet & Violet's Legendary Pokémon that Snacksworth's Treats bring.
  "After acquiring the corresponding Treat from Snacksworth, certain Legendary Pokémon will spawn in this area as a static encounter": "After its Treat from Snacksworth",
  "the Treat for it comes from group Blueberry Quests only": "Treat from group Blueberry Quests only",
};
const SNACKS = "After its Treat from Snacksworth";
const SNACKS_BBQ = "Treat from group Blueberry Quests only";
/** Legends: Z-A's hyperspace wild zones, under Hyperspace Lumiose: "4★ Grass-type hyperspace wild zone" is a "4★ Grass-type zone". */
const ZONE = /^(\d★ \w+-type) hyperspace wild zone$/;
/** DPPt's honey trees, as the data words them: "Honey Tree Group A (70% on normal trees / 20% on Munchlax trees)". */
const HONEY = /^Honey Tree Group ([A-Z]) \((\d+)% on normal trees \/ (\d+)% on Munchlax trees\)$/;

/**
 * A condition as the screens show it, saying the same in fewer words: "After the Hall of Fame"; a honey tree's group as
 * "Group A (70% normal / 20% Munchlax trees)" under a Honey Tree heading ("Honey tree group A (…)" under any other).
 */
const label = (part: string, method: string): string => {
  const honey = HONEY.exec(part);
  if (honey) return `${/honey/i.test(method) ? "Group" : "Honey tree group"} ${honey[1]} (${honey[2]}% normal / ${honey[3]}% Munchlax trees)`;
  const zone = ZONE.exec(part);
  if (zone) return `${zone[1]} zone`;
  return RELABEL[part] ?? part;
};

/** The parts of a condition as the screens say them, joined: "Have Fossilized Dino in bag; Have Fossilized Fish in bag" is "Fossilized Dino + Fossilized Fish". */
function say(list: readonly string[], method: string): string {
  let said = list.map((p) => label(p, method));
  // "After its Treat from Snacksworth (group Blueberry Quests only)", not the Treat twice.
  if (said.includes(SNACKS) && said.includes(SNACKS_BBQ)) said = said.filter((p) => p !== SNACKS_BBQ).map((p) => (p === SNACKS ? `${SNACKS} (group Blueberry Quests only)` : p));
  const bag = said.flatMap((p) => /^Have (.+) in bag$/.exec(p)?.[1] ?? []);
  if (bag.length < 2) return said.join("; ");
  const first = said.findIndex((p) => /^Have .+ in bag$/.test(p));
  return [...said.slice(0, first).filter((p) => !/^Have .+ in bag$/.test(p)), bag.join(" + "), ...said.slice(first + 1).filter((p) => !/^Have .+ in bag$/.test(p))].join("; ");
}

/**
 * Conditions that put a line after the story, and how the screens head such a line. Story-time and post-game lines are
 * never summed up together: a player mid-run reading "Lv 7–60" would think a level 60 could turn up.
 */
const POST: [RegExp, string][] = [
  [/^Enter the Hall of Fame$/, "After the Hall of Fame"],
  [/^Acquired National Pokédex$/, "After the National Pokédex"],
  [/^Elite four defeated$/i, "After the Elite Four"],
  [/^after becoming Champion$/i, "After becoming Champion"],
  [/^After completing The Way Home$/, "After The Way Home"],
];

/**
 * Kitakami's levels before Scarlet & Violet's story ends, which a line's condition gives ("Lv. 11-15 before completing The
 * Way Home"; its own levels are after it, or the same when "Bulbapedia lists no level for after it"): a story line at
 * those levels, and a post-game one at its own (none when they aren't known).
 */
const SCALED = /^Lv\. (\d+)(?:-(\d+))? before completing The Way Home$/;
const NO_LATER = "Bulbapedia lists no level for after it";
function unscale(e: NuzEncounter): NuzEncounter[] {
  const all = parts(e.condition);
  const scaled = all.map((p) => SCALED.exec(p)).find(Boolean);
  if (!scaled) return [e];
  const rest = all.filter((p) => !SCALED.test(p) && p !== NO_LATER);
  const story: NuzEncounter = { ...e, levels: [Number(scaled[1]), Number(scaled[2] ?? scaled[1])] };
  if (rest.length) story.condition = rest.join("; ");
  else delete story.condition;
  const later: NuzEncounter = { ...e, condition: [...rest, "After completing The Way Home"].join("; ") };
  if (all.includes(NO_LATER)) delete later.levels;
  return [story, later];
}
/** Their story-time side, left unsaid on a Pokémon that has a post-game line (which then says the difference). */
const PRE = new Set(["Before entering the Hall of Fame", "Before National Pokédex"]);

function postOf(e: NuzEncounter): { part: string; said: string } | null {
  for (const p of parts(e.condition)) for (const [re, said] of POST) if (re.test(p)) return { part: p, said };
  return null;
}

/** A line without some of its condition's parts. */
function without(e: NuzEncounter, drop: (part: string) => boolean): NuzEncounter {
  const kept = parts(e.condition).filter((p) => !drop(p));
  const out = { ...e };
  if (kept.length) out.condition = kept.join("; ");
  else delete out.condition;
  return out;
}

const parts = (condition: string | undefined): string[] => (condition ? condition.split("; ").filter(Boolean) : []);
const weatherOf = (e: NuzEncounter): string => parts(e.condition).map((p) => WEATHER[p]).find(Boolean) ?? NORMAL_WEATHER;

/** Up to this many plain lines (no weather) stay as they are: "1F 69% · B1F 20%" says more than a range. */
const KEEP = 3;

/** The parts of the day a game's lines name: all four (Scarlet & Violet's evening), day and night (Legends: Z-A), or DAY. */
export function dayOf(encounters: readonly NuzEncounter[]): string[] {
  const used = new Set(encounters.flatMap((e) => parts(e.condition).flatMap((p) => timesOf(p) ?? [])));
  return used.has("Evening") ? TIMES : used.has("Morning") || !used.size ? DAY : ["Day", "Night"];
}

/**
 * Add-on content a whole area is in (Kitakami is The Teal Mask's, the Terarium The Indigo Disk's): said once, by the
 * area's name, not on each of its lines.
 */
const ADD_ONS = ["The Teal Mask", "The Indigo Disk", "Mega Dimension"];
export function addOnOf(encounters: readonly NuzEncounter[]): string | undefined {
  return encounters.length ? ADD_ONS.find((d) => encounters.every((e) => parts(e.condition).includes(d))) : undefined;
}
export const withoutPart = (e: NuzEncounter, part: string): NuzEncounter => without(e, (p) => p === part);

/** `day`: the parts of the day the game has, so lines that cover them all say nothing of the time. */
export function compactEncounters(all: readonly NuzEncounter[], versions: readonly string[], day: readonly string[] = DAY): CompactEncounter[] {
  const encounters = all.flatMap(unscale);
  // The weathers of each way of meeting that has any (the Wild Area's grass does; its fishing and berry trees don't).
  const weathers = new Map<string, Set<string>>();
  for (const e of encounters) if (parts(e.condition).some((p) => p in WEATHER)) weathers.set(e.method, new Set());
  for (const e of encounters) weathers.get(e.method)?.add(weatherOf(e));
  // Each Pokémon's lines by way of meeting it, the post-game ones apart (their condition then says it, as `post`).
  const base = (e: NuzEncounter) => `${e.species}|${e.form ?? ""}|${e.kind}|${e.method}`;
  const hasPost = new Set(encounters.filter((e) => postOf(e)).map(base));
  const rows = new Map<string, { post: string | null; lines: NuzEncounter[] }>();
  for (const e of encounters) {
    const post = postOf(e);
    const line = post ? without(e, (p) => p === post.part) : hasPost.has(base(e)) ? without(e, (p) => PRE.has(p)) : e;
    const key = `${base(e)}|${post?.said ?? ""}`;
    const row = rows.get(key);
    if (row) row.lines.push(line);
    else rows.set(key, { post: post?.said ?? null, lines: [line] });
  }
  const out: CompactEncounter[] = [];
  for (const { post, lines } of rows.values()) {
    const tag = (e: CompactEncounter): CompactEncounter => (post ? { ...e, post } : e);
    const methodWeathers = weathers.get(lines[0].method) ?? null;
    if (!methodWeathers && lines.length <= KEEP) {
      for (const e of lines) out.push(tag(e.condition ? { ...e, condition: say(parts(e.condition), e.method) } : e));
      continue;
    }
    // Summed up version by version (a run is in one), then shared where the versions agree: in a run, a Pokémon shows
    // once per way of meeting it.
    const byResult = new Map<string, { entry: CompactEncounter; versions: string[] }>();
    for (const v of versions) {
      const mine = lines.filter((e) => !e.versions || e.versions.includes(v));
      if (!mine.length) continue;
      const entry = merge(mine, methodWeathers, day);
      const key = JSON.stringify(entry);
      const seen = byResult.get(key);
      if (seen) seen.versions.push(v);
      else byResult.set(key, { entry, versions: [v] });
    }
    for (const { entry, versions: vs } of byResult.values()) out.push(tag(vs.length === versions.length ? entry : { ...entry, versions: vs }));
  }
  return out;
}

function merge(lines: NuzEncounter[], methodWeathers: Set<string> | null, day: readonly string[]): CompactEncounter {
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
  const covered = new Set(times.flatMap((x) => (x ? timesOf(x)! : [])));
  const allDay = times.some((x) => !x) || day.every((x) => covered.has(x));
  const timeUnion = allDay ? null : TIMES.filter((x) => times.some((y) => timesOf(y!)!.includes(x)));
  each.forEach((p, i) => (each[i] = p.filter((x) => !timesOf(x))));

  // What every line says goes in `condition`; what only some do, in `when`. A line that's only "in one of these places"
  // gives each place its own chip, said once: "Area 2 / Main Area" and "Area 2" are "Area 2" and "Main Area".
  const common = each[0].filter((x) => each.every((p) => p.includes(x)));
  const own = each.map((p) => p.filter((x) => !common.includes(x)));
  let rest = [...new Set(own.flatMap((p) => (p.length === 1 && / \/ /.test(p[0]) && !/[()]/.test(p[0]) ? p[0].split(" / ").map((x) => say([x], lines[0].method)) : [say(p, lines[0].method)])).filter(Boolean))];
  // What they all begin with is said once: "After visiting Solaceon Ruins…, at the dam" and "…, in the pond" are "After
  // visiting Solaceon Ruins…" with "at the dam" and "in the pond".
  const lead = rest.length > 1 && !rest.some((x) => x.includes("; ")) ? sharedLead(rest) : "";
  if (lead) {
    common.push(lead);
    rest = rest.map((x) => x.slice(lead.length + 2));
  }
  if (timeUnion) when.push(timeUnion.join(", "));
  when.push(...rest);

  const rates = lines.flatMap((e) => (e.rate !== undefined ? [e.rate] : []));
  const levels = lines.flatMap((e) => (e.levels ? [e.levels] : []));
  if (common.length) out.condition = say(common, lines[0].method);
  if (when.length) out.when = when;
  if (rates.length) {
    out.rate = Math.max(...rates);
    const min = Math.min(...rates);
    if (min !== out.rate) out.rateMin = min;
  }
  if (levels.length) out.levels = [Math.min(...levels.map((l) => l[0])), Math.max(...levels.map((l) => l[1]))];
  return out;
}

/** The words up to a ", " that every one of these begins with (and goes on after), or "". */
function sharedLead(all: readonly string[]): string {
  let lead = all[0];
  for (const x of all) while (lead && !x.startsWith(`${lead}, `)) lead = lead.includes(", ") ? lead.slice(0, lead.lastIndexOf(", ")) : "";
  return lead.length >= 12 ? lead : "";
}
