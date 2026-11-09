import RACE_FORMS from "@/data/race-forms.json";
import { POKEDEX, type Pokemon, type StatKey } from "@/lib/pokemon/pokedex";
import { GENERATION_REGIONS, STAT_LABELS } from "@/lib/pokemon/constants";
import { TYPES, capitalize, type PokemonType } from "@/lib/pokemon/type-matrix";

/**
 * Pokémon rankings (/pokedex/rankings): every list is computed from the
 * committed Pokédex snapshot (src/data/pokedex.json) and, for the lists with
 * forms, the alternate forms with their own stats or size
 * (src/data/race-forms.json). Both come from PokéAPI.
 */

export const RANKINGS_PATH = "/pokedex/rankings";

export type RankKey = StatKey | "bst" | "bulk" | "height" | "weight";

export interface Metric {
  slug: string;
  key: RankKey;
  dir: "desc" | "asc";
  /** "Heaviest", or null for the "with the highest <stat>" lists. */
  adjective: string | null;
  /** The measure in a title: "Weight", "Base Speed", "Base Stat Total". */
  measure: string;
  /** Column header for the value. */
  column: string;
  /** The list running the other way, if it has a page. */
  opposite?: string;
  /** Per-type and per-generation pages. */
  byType: boolean;
  byGen: boolean;
  /** Also a page without legendary and mythical Pokémon. */
  byCore?: boolean;
}

const stat = (slug: string, key: StatKey, byGen = false): Metric => ({
  slug,
  key,
  dir: "desc",
  adjective: null,
  measure: `Base ${STAT_LABELS[key].replace("Sp. Atk", "Special Attack").replace("Sp. Def", "Special Defense")}`,
  column: STAT_LABELS[key],
  byType: true,
  byGen,
});

export const METRICS: Metric[] = [
  { slug: "strongest", key: "bst", dir: "desc", adjective: "Strongest", measure: "Base Stat Total", column: "Total", byType: true, byGen: true, byCore: true },
  { slug: "bulkiest", key: "bulk", dir: "desc", adjective: "Bulkiest", measure: "Bulk (HP + Defense + Special Defense)", column: "Bulk", byType: true, byGen: true, byCore: true },
  { slug: "fastest", key: "spe", dir: "desc", adjective: "Fastest", measure: "Base Speed", column: "Speed", opposite: "slowest", byType: true, byGen: true, byCore: true },
  { slug: "slowest", key: "spe", dir: "asc", adjective: "Slowest", measure: "Base Speed", column: "Speed", opposite: "fastest", byType: false, byGen: false },
  { slug: "heaviest", key: "weight", dir: "desc", adjective: "Heaviest", measure: "Weight", column: "Weight", opposite: "lightest", byType: true, byGen: true },
  { slug: "lightest", key: "weight", dir: "asc", adjective: "Lightest", measure: "Weight", column: "Weight", opposite: "heaviest", byType: false, byGen: false },
  { slug: "tallest", key: "height", dir: "desc", adjective: "Tallest", measure: "Height", column: "Height", opposite: "shortest", byType: true, byGen: true },
  { slug: "shortest", key: "height", dir: "asc", adjective: "Shortest", measure: "Height", column: "Height", opposite: "tallest", byType: false, byGen: false },
  stat("highest-hp", "hp"),
  stat("highest-attack", "atk", true),
  stat("highest-defense", "def"),
  stat("highest-special-attack", "spa", true),
  stat("highest-special-defense", "spd"),
];

const METRIC_BY_SLUG = new Map(METRICS.map((m) => [m.slug, m]));
export const getMetric = (slug: string): Metric | undefined => METRIC_BY_SLUG.get(slug);

/** The stat's name in prose: "Attack", "Special Attack". */
function statName(m: Metric): string {
  return m.measure.replace(/^Base /, "");
}

// ---------- entries ----------

export type FormKind = "mega" | "regional" | "form";

export interface RankEntry {
  /** Unique: the species slug, or the form's slug. */
  key: string;
  species: number;
  /** The species' Pokédex entry. */
  slug: string;
  name: string;
  /** The species' name, when the entry is a form. */
  speciesName: string | null;
  form: FormKind | null;
  /** Artwork id: the dex number, or the form's PokéAPI id. */
  art: number;
  types: string[];
  gen: number;
  stats: Record<StatKey, number>;
  bst: number;
  /** Decimetres. */
  height: number;
  /** Hectograms. */
  weight: number;
  /** A legendary or mythical species (its forms included). */
  legendary?: boolean;
}

interface FormRow {
  id: number;
  species: number;
  slug: string;
  name: string;
  kind: string;
  height: number;
  weight: number;
  types: string[];
  stats: number[];
}

export function speciesEntry(p: Pokemon): RankEntry {
  return {
    key: p.slug,
    species: p.id,
    slug: p.slug,
    name: p.name,
    speciesName: null,
    form: null,
    art: p.id,
    types: [...p.types],
    gen: p.gen,
    stats: { ...p.stats },
    bst: p.bst,
    height: p.height,
    weight: p.weight,
    legendary: p.legendary || p.mythical,
  };
}

export function formEntry(f: FormRow, species: Pokemon): RankEntry {
  const [hp, atk, def, spa, spd, spe] = f.stats;
  return {
    key: f.slug,
    species: species.id,
    slug: species.slug,
    name: f.name,
    speciesName: species.name,
    form: f.kind === "mega" || f.kind === "regional" ? f.kind : "form",
    art: f.id,
    types: [...f.types],
    gen: species.gen,
    stats: { hp, atk, def, spa, spd, spe },
    bst: hp + atk + def + spa + spd + spe,
    height: f.height,
    weight: f.weight,
    legendary: species.legendary || species.mythical,
  };
}

const SPECIES_BY_ID = new Map(POKEDEX.map((p) => [p.id, p]));
export const SPECIES_ENTRIES: RankEntry[] = POKEDEX.map(speciesEntry);
export const FORM_ENTRIES: RankEntry[] = (RACE_FORMS as { forms: FormRow[] }).forms.flatMap((f) => {
  const p = SPECIES_BY_ID.get(f.species);
  return p ? [formEntry(f, p)] : [];
});

// ---------- scopes (the variant pages) ----------

export type Scope = { kind: "all" } | { kind: "type"; type: PokemonType } | { kind: "gen"; gen: number } | { kind: "forms" } | { kind: "core" };

export const ALL: Scope = { kind: "all" };
export const FORMS_SEGMENT = "all-forms";
/** Legendary and mythical Pokémon left out. */
export const CORE_SEGMENT = "non-legendary";
/** A variant page needs at least this many Pokémon to be worth a page of its own. */
export const MIN_VARIANT_ROWS = 20;

export function scopeSegment(s: Scope): string | null {
  if (s.kind === "type") return s.type;
  if (s.kind === "gen") return `gen-${s.gen}`;
  if (s.kind === "forms") return FORMS_SEGMENT;
  if (s.kind === "core") return CORE_SEGMENT;
  return null;
}

export function parseScope(segment: string): Scope | null {
  if (segment === FORMS_SEGMENT) return { kind: "forms" };
  if (segment === CORE_SEGMENT) return { kind: "core" };
  if ((TYPES as readonly string[]).includes(segment)) return { kind: "type", type: segment as PokemonType };
  const g = /^gen-([1-9])$/.exec(segment);
  if (g) return { kind: "gen", gen: Number(g[1]) };
  return null;
}

/** A list's preview card (lib/og/rankings), drawn on request: `/pokedex/rankings/og?m=heaviest&s=fire`. */
export function rankingImagePath(metric?: string, s: Scope = ALL): string {
  if (!metric) return `${RANKINGS_PATH}/og`;
  const seg = scopeSegment(s);
  return `${RANKINGS_PATH}/og?m=${metric}${seg ? `&s=${seg}` : ""}`;
}

export function rankingPath(metric: string, s: Scope = ALL): string {
  const seg = scopeSegment(s);
  return `${RANKINGS_PATH}/${metric}${seg ? `/${seg}` : ""}`;
}

/** Who a scope's list ranks. Type and generation lists rank default forms only. */
export function entriesFor(s: Scope, species: RankEntry[] = SPECIES_ENTRIES, forms: RankEntry[] = FORM_ENTRIES): RankEntry[] {
  if (s.kind === "forms") return [...species, ...forms];
  if (s.kind === "type") return species.filter((e) => e.types.includes(s.type));
  if (s.kind === "gen") return species.filter((e) => e.gen === s.gen);
  if (s.kind === "core") return species.filter((e) => !e.legendary);
  return species;
}

export function metricAllowsScope(m: Metric, s: Scope): boolean {
  if (s.kind === "all" || s.kind === "forms") return true;
  if (s.kind === "type") return m.byType;
  if (s.kind === "core") return !!m.byCore;
  return m.byGen;
}

/** Every variant page that gets built: allowed for the metric and with enough Pokémon. */
export function variantScopes(m: Metric): Scope[] {
  const out: Scope[] = [{ kind: "forms" }];
  if (m.byCore) out.push({ kind: "core" });
  if (m.byType) for (const type of TYPES) out.push({ kind: "type", type });
  if (m.byGen) for (const gen of Object.keys(GENERATION_REGIONS).map(Number)) out.push({ kind: "gen", gen });
  return out.filter((s) => entriesFor(s).length >= MIN_VARIANT_ROWS);
}

export function isBuiltPage(metric: string, s: Scope): boolean {
  const m = getMetric(metric);
  if (!m) return false;
  if (s.kind === "all") return true;
  const seg = scopeSegment(s);
  return variantScopes(m).some((v) => scopeSegment(v) === seg);
}

// ---------- ranking ----------

export function valueOf(e: RankEntry, key: RankKey): number {
  if (key === "bst") return e.bst;
  if (key === "bulk") return e.stats.hp + e.stats.def + e.stats.spd;
  if (key === "height") return e.height;
  if (key === "weight") return e.weight;
  return e.stats[key];
}

export interface Ranked {
  /** Competition ranking: equal values share a rank, the next rank skips (1, 1, 3). */
  rank: number;
  tied: boolean;
  value: number;
  entry: RankEntry;
}

/** Sorted best first for the metric; ties keep National Dex order, a species before its forms. */
export function rankEntries(entries: RankEntry[], m: Pick<Metric, "key" | "dir">): Ranked[] {
  const sign = m.dir === "desc" ? -1 : 1;
  const sorted = [...entries].sort(
    (a, b) =>
      sign * (valueOf(a, m.key) - valueOf(b, m.key)) ||
      a.species - b.species ||
      Number(a.form !== null) - Number(b.form !== null) ||
      a.art - b.art
  );
  const counts = new Map<number, number>();
  for (const e of sorted) counts.set(valueOf(e, m.key), (counts.get(valueOf(e, m.key)) ?? 0) + 1);
  const out: Ranked[] = [];
  sorted.forEach((entry, i) => {
    const value = valueOf(entry, m.key);
    const prev = out[i - 1];
    const rank = prev && prev.value === value ? prev.rank : i + 1;
    out.push({ rank, tied: (counts.get(value) ?? 0) > 1, value, entry });
  });
  return out;
}

const CACHE = new Map<string, Ranked[]>();
export function ranking(m: Metric, s: Scope = ALL): Ranked[] {
  const id = `${m.slug}/${scopeSegment(s) ?? ""}`;
  let r = CACHE.get(id);
  if (!r) {
    r = rankEntries(entriesFor(s), m);
    CACHE.set(id, r);
  }
  return r;
}

// ---------- units ----------

const oneDecimal = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 9999 hg → "999.9 kg". */
export const kg = (hg: number) => `${oneDecimal(hg / 10)} kg`;
/** 9999 hg → "2,204.4 lbs". */
export const lbs = (hg: number) => `${oneDecimal(Math.round(hg * 2.2046226218) / 10)} lbs`;
/** 145 dm → "14.5 m". */
export const metres = (dm: number) => `${oneDecimal(dm / 10)} m`;
/** 145 dm → "47′07″" (to the nearest inch). */
export function feet(dm: number): string {
  const inches = Math.round((dm * 10) / 2.54);
  return `${Math.floor(inches / 12)}′${String(inches % 12).padStart(2, "0")}″`;
}

/** The value as a table cell shows it: metric first, imperial second (null for stats). */
export function formatValue(key: RankKey, v: number): { main: string; alt: string | null } {
  if (key === "weight") return { main: kg(v), alt: lbs(v) };
  if (key === "height") return { main: metres(v), alt: feet(v) };
  return { main: String(v), alt: null };
}

/** "999.9 kg / 2,204.4 lbs", for inside brackets. */
export function shortValue(key: RankKey, v: number): string {
  const f = formatValue(key, v);
  return f.alt ? `${f.main} / ${f.alt}` : f.main;
}

/** "999.9 kg (2,204.4 lbs)", "200". */
export function valueText(key: RankKey, v: number): string {
  const f = formatValue(key, v);
  return f.alt ? `${f.main} (${f.alt})` : f.main;
}

// ---------- copy ----------

/** "Fire-type", "Gen 1" (or "Gen 1 (Kanto)"), "" — the words a scope adds before "Pokémon". */
function scopeWords(s: Scope, region = false): string {
  if (s.kind === "type") return `${capitalize(s.type)}-type`;
  if (s.kind === "core") return "non-legendary";
  if (s.kind === "gen") return region ? `Gen ${s.gen} (${GENERATION_REGIONS[s.gen]})` : `Gen ${s.gen}`;
  return "";
}

/** The measure in a sentence: "weight", "base stat total", "base Special Attack". */
function measureProse(m: Metric): string {
  if (m.key === "weight" || m.key === "height") return m.measure.toLowerCase();
  if (m.key === "bst") return "base stat total";
  if (m.key === "bulk") return "bulk (HP, Defense and Special Defense combined)";
  return `base ${statName(m)}`;
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

/** The page's H1: "Heaviest Fire-type Pokémon", "Gen 1 Pokémon with the highest Attack", "Fastest Pokémon including Megas and forms". */
export function rankingHeading(m: Metric, s: Scope, region = false): string {
  const pokemon = join(scopeWords(s, region), "Pokémon");
  const base = m.adjective ? join(m.adjective, pokemon) : `${pokemon} with the highest ${statName(m)}`;
  return s.kind === "forms" ? `${base} including Megas and forms` : base;
}

/** "the heaviest Fire-type Pokémon", or null for the stat lists (they read "has the highest base Attack of any …"). */
function superlative(m: Metric, s: Scope): string | null {
  return m.adjective ? `the ${m.adjective.toLowerCase()} ${join(scopeWords(s), "Pokémon")}` : null;
}

/** The leader question: "What is the heaviest Fire-type Pokémon?", "Which Pokémon has the highest base Attack?" */
function leaderQuestion(m: Metric, s: Scope): string {
  const sup = superlative(m, s);
  return sup ? `What is ${sup}?` : `Which ${join(scopeWords(s), "Pokémon")} has the highest ${measureProse(m)}?`;
}

export function rankingTitle(m: Metric, s: Scope): string {
  const head = rankingHeading(m, s, true);
  if (s.kind === "all") return `${head}: Every Pokémon Ranked by ${m.measure}`;
  return `${head}: Ranked by ${m.measure}`;
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** How a value reads in a sentence: "at 999.9 kg (2,204.4 lbs)", "with a base Speed of 200". */
function valuePhrase(m: Metric, v: number): string {
  if (m.key === "weight" || m.key === "height") return `at ${valueText(m.key, v)}`;
  if (m.key === "bst") return `with a base stat total of ${v}`;
  if (m.key === "bulk") return `with HP, Defense and Special Defense adding up to ${v}`;
  return `with a base ${statName(m)} of ${v}`;
}

/** The names at the top: up to six, then "and N more" (the factual size of the tie). */
function leaderNames(r: Ranked[]): string {
  const top = r.filter((x) => x.rank === 1).map((x) => x.entry.name);
  if (top.length <= 6) return names(top);
  return `${top.slice(0, 5).join(", ")} and ${top.length - 5} more`;
}

/** "Celesteela and Cosmoem are the heaviest Pokémon, tied at 999.9 kg (2,204.4 lbs)." */
export function leaderSentence(m: Metric, s: Scope, r: Ranked[] = ranking(m, s)): string {
  if (!r.length) return "";
  const tied = r.filter((x) => x.rank === 1).length > 1;
  const sup = superlative(m, s);
  if (!sup) {
    const of = `of any ${join(scopeWords(s), "Pokémon")}`;
    return `${leaderNames(r)} ${tied ? "share" : "has"} the highest ${measureProse(m)} ${of}, at ${r[0].value}.`;
  }
  const phrase = valuePhrase(m, r[0].value);
  return `${leaderNames(r)} ${tied ? "are" : "is"} ${sup}, ${tied ? `tied ${phrase}` : phrase}.`;
}

/** "Next come Eternatus (950.0 kg / 2,094.4 lbs) and Groudon (950.0 kg)." — the two after the leaders. */
export function runnersUpSentence(m: Metric, r: Ranked[]): string {
  const next = r.filter((x) => x.rank > 1).slice(0, 2);
  if (!next.length) return "";
  const parts = next.map((x) => `${x.entry.name} (${shortValue(m.key, x.value)})`);
  return `${next.length > 1 ? "Next come" : "Next is"} ${names(parts)}.`;
}

/** What the list counts, stated on the page. */
export function countingNote(m: Metric, s: Scope): string {
  const source = m.key === "bulk" ? `Bulk is a species' base HP, Defense and Special Defense added together, before IVs, EVs, natures and level` : m.key === "weight" || m.key === "height" ? `Heights and weights are the Pokédex figures for each Pokémon` : `Base stats are each species' fixed values, before IVs, EVs, natures and level`;
  if (s.kind === "forms")
    return `This list includes Mega Evolutions, Primal Reversions, regional forms and other forms with their own stats, types or size, alongside each species' default form. Gigantamax and Eternamax forms are left out. ${source}.`;
  const scope =
    s.kind === "core"
      ? `It ranks one entry per species in its default form and leaves out every legendary and mythical Pokémon`
      : s.kind === "type"
      ? `It ranks every Pokémon with the ${capitalize(s.type)} type, single- or dual-typed, in its default form`
      : s.kind === "gen"
        ? `It ranks the Pokémon introduced in Generation ${s.gen} (${GENERATION_REGIONS[s.gen]}) in their default forms; regional forms from later games are not counted`
        : `It ranks one entry per species, each in its default form; Mega Evolutions, regional forms and other forms are ranked in the version with forms`;
  return `${scope}. ${source}.`;
}

export function rankingDescription(m: Metric, s: Scope, r: Ranked[] = ranking(m, s)): string {
  const tail =
    m.key === "weight" || m.key === "height"
      ? `in metric and imperial units, with types and links to each Pokédex entry.`
      : `with types, base stat totals and links to each Pokédex entry.`;
  const scope = s.kind === "forms" ? "Every Pokémon, Mega Evolution and form" : `Every ${join(scopeWords(s), "Pokémon")}`;
  return `${leaderSentence(m, s, r)} ${scope} ranked by ${measureProse(m)}, ${tail}`;
}

export interface Faq {
  q: string;
  a: string;
}

/** Short questions answered from the list itself. */
export function rankingFaq(m: Metric, s: Scope): Faq[] {
  const r = ranking(m, s);
  if (!r.length) return [];
  const out: Faq[] = [{ q: leaderQuestion(m, s), a: leaderSentence(m, s, r) }];
  const opp = m.opposite ? getMetric(m.opposite) : undefined;
  if (opp && metricAllowsScope(opp, s) && (s.kind === "all" || s.kind === "forms" || isBuiltPage(opp.slug, s))) {
    out.push({ q: leaderQuestion(opp, s), a: leaderSentence(opp, s) });
  } else if (r.length >= 3) {
    const top = r.slice(0, 3).map((x) => `${x.entry.name} (${shortValue(m.key, x.value)})`);
    out.push({ q: `Which ${join(scopeWords(s), "Pokémon")} rank highest for ${measureProse(m)}?`, a: `The top three are ${names(top)}.` });
  }
  if (s.kind === "all") {
    const withForms = ranking(m, { kind: "forms" });
    const leader = withForms[0];
    const changes = leader.entry.form !== null;
    out.push({
      q: "Do Mega Evolutions and other forms change the ranking?",
      a: changes
        ? `Yes. With forms counted, ${leaderNames(withForms)} ${withForms.filter((x) => x.rank === 1).length > 1 ? "share" : "takes"} first place (${shortValue(m.key, leader.value)}).`
        : `No. With forms counted, ${leaderNames(withForms)} still ${withForms.filter((x) => x.rank === 1).length > 1 ? "share" : "holds"} first place (${shortValue(m.key, leader.value)}).`,
    });
  }
  return out;
}

/** The sorted Pokédex explorer for the same list (?sort=…&type=…&gen=…&dir=asc). */
export function explorerHref(m: Metric, s: Scope): string | null {
  if (m.key === "bulk" || s.kind === "core") return null;
  const q = new URLSearchParams({ sort: m.key });
  if (s.kind === "type") q.set("type", s.type);
  if (s.kind === "gen") q.set("gen", String(s.gen));
  if (m.dir === "asc") q.set("dir", "asc");
  return `/pokedex?${q}`;
}

/** Short link text for a list: "Heaviest", "Highest Attack". */
export function metricShortLabel(m: Metric): string {
  return m.adjective ?? `Highest ${statName(m)}`;
}

// ---------- every page ----------

export interface RankingPage {
  metric: Metric;
  scope: Scope;
  path: string;
}

export function allRankingPages(): RankingPage[] {
  return METRICS.flatMap((m) => [ALL, ...variantScopes(m)].map((scope) => ({ metric: m, scope, path: rankingPath(m.slug, scope) })));
}

// ---------- facts for a Pokémon's entry ----------

export interface RankingFact {
  text: string;
  href: string;
  rank: number;
}

/**
 * Where a species places in the lists, for its Pokédex entry: the overall
 * lists where it makes the top 25, and its types' lists where it makes the
 * top 5. Best placings first, at most `limit`.
 */
export function rankingFacts(slug: string, limit = 4): RankingFact[] {
  const out: RankingFact[] = [];
  const entry = SPECIES_ENTRIES.find((e) => e.slug === slug);
  if (!entry) return out;
  const add = (m: Metric, s: Scope, cap: number) => {
    const row = ranking(m, s).find((x) => x.entry.key === slug);
    if (!row || row.rank > cap) return;
    const what = m.adjective ? `${m.adjective.toLowerCase()} ${join(scopeWords(s), "Pokémon")}` : `${join(scopeWords(s), "Pokémon")} by ${statName(m)}`;
    out.push({ text: `#${row.rank}${row.tied ? " (tied)" : ""} ${what}`, href: `${rankingPath(m.slug, s)}#${slug}`, rank: row.rank });
  };
  for (const m of METRICS) {
    add(m, ALL, 25);
    if (m.byType) for (const t of entry.types) if (isBuiltPage(m.slug, { kind: "type", type: t as PokemonType })) add(m, { kind: "type", type: t as PokemonType }, 5);
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}
