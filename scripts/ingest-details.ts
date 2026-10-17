/**
 * Build-time ingest for the study Pokédex: PokéAPI GraphQL ->
 *   src/data/pokedex-details.json   per-species deep data (forms, evolution
 *                                   methods, every Pokédex entry, breeding,
 *                                   training, regional dex numbers, learnsets)
 *   src/data/moves.json             move table referenced by the learnsets
 *
 *   npm run ingest
 *
 * Kept separate from pokedex.json so the quiz runtime never loads it — only
 * the statically generated /pokemon/[slug] pages read it, at build time.
 */
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const DATA_DIR = path.join(process.cwd(), "src/data");
const SPECIES_COUNT = 1025;
const CHUNK = 150;

async function gql<T>(query: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: T; errors?: unknown };
      if (body.data) return body.data;
      throw new Error(`GraphQL errors: ${JSON.stringify(body.errors).slice(0, 500)}`);
    }
    if (attempt >= 4) throw new Error(`PokéAPI GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const wait = 2000 * 2 ** attempt;
    console.warn(`  ${res.status} — retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const clean = (text: string) =>
  text
    .replace(/-[\n\f\r]+/g, "-") // words hyphenated across a line break
    .replace(/[\n\f\r]+/g, " ")
    .replace(/­\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Gen 1–5 entries shout names ("CHARIZARD", "POKéMON"); restore normal casing. */
const SPECIES_NAMES = new Map<string, string>(
  (JSON.parse(fs.readFileSync(path.join(DATA_DIR, "pokedex.json"), "utf8")) as { name: string }[]).map((p) => [
    p.name.toUpperCase(),
    p.name,
  ])
);

function decapitalize(text: string): string {
  return text
    .replace(/POK[ÉéE]MON/g, "Pokémon")
    .replace(/POK[ÉéE] BALL/g, "Poké Ball")
    .replace(/\b[A-Z][A-Z'.\u00C0-\u00DE-]{2,}\b/g, (word) => SPECIES_NAMES.get(word) ?? word);
}

const STAT_KEYS: Record<string, string> = {
  hp: "hp",
  attack: "atk",
  defense: "def",
  "special-attack": "spa",
  "special-defense": "spd",
  speed: "spe",
};

// ---------------------------------------------------------------------------
// Species details
// ---------------------------------------------------------------------------

interface RawEvo {
  min_level: number | null;
  min_happiness: number | null;
  min_affection: number | null;
  min_beauty: number | null;
  time_of_day: string;
  needs_overworld_rain: boolean;
  turn_upside_down: boolean;
  relative_physical_stats: number | null;
  gender_id: number | null;
  trig: { name: string } | null;
  item: { name: string } | null;
  held: { name: string } | null;
  move: { name: string } | null;
  mtype: { name: string } | null;
  loc: { name: string } | null;
  party: { name: string } | null;
  ptype: { name: string } | null;
  trade: { name: string } | null;
}

interface RawVariety {
  id: number;
  name: string;
  is_default: boolean;
  base_experience: number | null;
  types: { t: { name: string } }[];
  stats: { base_stat: number; effort: number; s: { name: string } }[];
  abil: { is_hidden: boolean; a: { name: string; e: { short_effect: string }[]; f: { flavor_text: string }[] } }[];
  forms: { n: { pokemon_name: string }[] }[];
}

interface RawDetail {
  id: number;
  capture_rate: number | null;
  base_happiness: number | null;
  gender_rate: number;
  hatch_counter: number | null;
  is_baby: boolean;
  has_gender_differences: boolean;
  growth: { name: string } | null;
  eggs: { g: { name: string } }[];
  evo: RawEvo[];
  flavor: { flavor_text: string; v: { name: string } }[];
  dex: { pokedex_number: number; d: { name: string; is_main_series: boolean } }[];
  varieties: RawVariety[];
}

const DETAIL_QUERY = (from: number, to: number) => /* GraphQL */ `{
  s: pokemon_v2_pokemonspecies(where: { id: { _gte: ${from}, _lte: ${to} } }, order_by: { id: asc }) {
    id capture_rate base_happiness gender_rate hatch_counter is_baby has_gender_differences
    growth: pokemon_v2_growthrate { name }
    eggs: pokemon_v2_pokemonegggroups { g: pokemon_v2_egggroup { name } }
    evo: pokemon_v2_pokemonevolutions {
      min_level min_happiness min_affection min_beauty time_of_day needs_overworld_rain
      turn_upside_down relative_physical_stats gender_id
      trig: pokemon_v2_evolutiontrigger { name }
      item: pokemon_v2_item { name }
      held: pokemonV2ItemByHeldItemId { name }
      move: pokemon_v2_move { name }
      mtype: pokemon_v2_type { name }
      loc: pokemon_v2_location { name }
      party: pokemonV2PokemonspecyByPartySpeciesId { name }
      ptype: pokemonV2TypeByPartyTypeId { name }
      trade: pokemonV2PokemonspecyByTradeSpeciesId { name }
    }
    flavor: pokemon_v2_pokemonspeciesflavortexts(where: { language_id: { _eq: 9 } }, order_by: { version_id: asc }) {
      flavor_text v: pokemon_v2_version { name }
    }
    dex: pokemon_v2_pokemondexnumbers { pokedex_number d: pokemon_v2_pokedex { name is_main_series } }
    varieties: pokemon_v2_pokemons(order_by: { id: asc }) {
      id name is_default base_experience
      types: pokemon_v2_pokemontypes(order_by: { slot: asc }) { t: pokemon_v2_type { name } }
      stats: pokemon_v2_pokemonstats { base_stat effort s: pokemon_v2_stat { name } }
      abil: pokemon_v2_pokemonabilities(order_by: { slot: asc }) {
        is_hidden
        a: pokemon_v2_ability {
          name
          e: pokemon_v2_abilityeffecttexts(where: { language_id: { _eq: 9 } }) { short_effect }
          f: pokemon_v2_abilityflavortexts(where: { language_id: { _eq: 9 } }, order_by: { version_group_id: desc }, limit: 1) { flavor_text }
        }
      }
      forms: pokemon_v2_pokemonforms(limit: 1) { n: pokemon_v2_pokemonformnames(where: { language_id: { _eq: 9 } }) { pokemon_name } }
    }
  }
}`;

/** Human-readable evolution requirement, e.g. "Level 36" or "Trade holding Metal Coat". */
function describeEvolution(e: RawEvo): string {
  const trigger = e.trig?.name ?? "level-up";
  const extras: string[] = [];
  if (e.min_happiness) extras.push("with high friendship");
  if (e.min_affection) extras.push("with high affection");
  if (e.min_beauty) extras.push("with high Beauty");
  if (e.held) extras.push(`holding ${titleCase(e.held.name)}`);
  if (e.move) extras.push(`knowing ${titleCase(e.move.name)}`);
  if (e.mtype) extras.push(`knowing a ${titleCase(e.mtype.name)}-type move`);
  if (e.party) extras.push(`with ${titleCase(e.party.name)} in the party`);
  if (e.ptype) extras.push(`with a ${titleCase(e.ptype.name)}-type in the party`);
  if (e.loc) extras.push(`at ${titleCase(e.loc.name)}`);
  if (e.time_of_day === "day") extras.push("during the day");
  if (e.time_of_day === "night") extras.push("at night");
  if (e.time_of_day === "dusk") extras.push("at dusk");
  if (e.needs_overworld_rain) extras.push("while it's raining");
  if (e.turn_upside_down) extras.push("with the console upside down");
  if (e.relative_physical_stats === 1) extras.push("when Attack > Defense");
  if (e.relative_physical_stats === -1) extras.push("when Attack < Defense");
  if (e.relative_physical_stats === 0) extras.push("when Attack = Defense");
  if (e.gender_id === 1) extras.push("(female)");
  if (e.gender_id === 2) extras.push("(male)");
  const tail = extras.length ? ` ${extras.join(", ")}` : "";

  switch (trigger) {
    case "level-up":
      return e.min_level ? `Level ${e.min_level}${tail}` : `Level up${tail}`;
    case "use-item":
      return `Use ${e.item ? titleCase(e.item.name) : "an item"}${tail}`;
    case "trade":
      return `Trade${e.trade ? ` for ${titleCase(e.trade.name)}` : ""}${tail}`;
    case "shed":
      return "Level 20 with an empty party slot and a spare Poké Ball";
    case "spin":
      return `Spin around holding a Sweet${tail}`;
    case "three-critical-hits":
      return "Land three critical hits in one battle";
    case "take-damage":
      return "Take 49+ damage, then walk under the Dusty Bowl arch";
    case "tower-of-darkness":
      return "Train in the Tower of Darkness";
    case "tower-of-waters":
      return "Train in the Tower of Waters";
    case "agile-style-move":
      return `Use ${e.move ? titleCase(e.move.name) : "a move"} 20 times in Agile Style`;
    case "strong-style-move":
      return `Use ${e.move ? titleCase(e.move.name) : "a move"} 20 times in Strong Style`;
    case "recoil-damage":
      return "Take 294 recoil damage without fainting";
    case "use-move":
      return `Use ${e.move ? titleCase(e.move.name) : "a move"} 20 times`;
    default:
      return `${titleCase(trigger)}${tail}`;
  }
}

/** "Level up at A" + "Level up at B" -> "Level up at A or B" (Leafeon, Glaceon, Magnezone…). */
function mergeLocations(evos: RawEvo[]): string[] {
  const byTemplate = new Map<string, string[]>();
  for (const e of evos) {
    const loc = e.loc ? titleCase(e.loc.name) : null;
    const template = describeEvolution({ ...e, loc: loc ? { name: "__loc__" } : null }).replace("__loc__", "{loc}");
    const list = byTemplate.get(template) ?? [];
    if (loc && !list.includes(loc)) list.push(loc);
    byTemplate.set(template, list);
  }
  return [...byTemplate].map(([template, locs]) => {
    if (!locs.length) return template;
    const joined = locs.length > 1 ? `${locs.slice(0, -1).join(", ")} or ${locs[locs.length - 1]}` : locs[0];
    return template.replace("{loc}", joined);
  });
}

function abilitiesOf(v: RawVariety) {
  return v.abil.map((a) => ({
    name: titleCase(a.a.name),
    hidden: a.is_hidden,
    effect: clean(a.a.e[0]?.short_effect ?? a.a.f[0]?.flavor_text ?? ""),
  }));
}

function statsOf(v: RawVariety) {
  return Object.fromEntries(v.stats.map((s) => [STAT_KEYS[s.s.name], s.base_stat])) as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Moves + learnsets
// ---------------------------------------------------------------------------

/** Preferred source game for a learnset, newest first; DLC groups merge into their base game. */
const GAMES: { label: string; groups: number[] }[] = [
  { label: "Scarlet & Violet", groups: [25, 26, 27] },
  { label: "Sword & Shield", groups: [20, 21, 22] },
  { label: "Brilliant Diamond & Shining Pearl", groups: [23] },
  { label: "Legends: Arceus", groups: [24] },
  { label: "Ultra Sun & Ultra Moon", groups: [18] },
  { label: "Let's Go Pikachu & Eevee", groups: [19] },
];

const METHOD_CODE: Record<number, string> = { 1: "L", 2: "E", 3: "T", 4: "M" };

interface RawLearn {
  pokemon_id: number;
  move_id: number;
  level: number;
  move_learn_method_id: number;
}

async function fetchLearnsets(groups: number[], pokemonIds: number[]): Promise<RawLearn[]> {
  const rows: RawLearn[] = [];
  const PAGE = 20_000;
  for (let offset = 0; ; offset += PAGE) {
    const data = await gql<{ m: RawLearn[] }>(`{
      m: pokemon_v2_pokemonmove(
        where: {
          version_group_id: { _in: [${groups.join(",")}] }
          pokemon_id: { _in: [${pokemonIds.join(",")}] }
          move_learn_method_id: { _in: [1, 2, 3, 4] }
        }
        order_by: { id: asc }
        limit: ${PAGE}
        offset: ${offset}
      ) { pokemon_id move_id level move_learn_method_id }
    }`);
    rows.push(...data.m);
    if (data.m.length < PAGE) return rows;
  }
}

interface RawMove {
  id: number;
  name: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  move_effect_chance: number | null;
  generation_id: number;
  type: { name: string } | null;
  cls: { name: string } | null;
  eff: { t: { short_effect: string }[] } | null;
  flav: { flavor_text: string }[];
  names: { name: string }[];
  mach: { version_group_id: number; item: { name: string } }[];
}

async function main() {
  // --- species details ------------------------------------------------------
  const details: Record<number, unknown> = {};
  for (let from = 1; from <= SPECIES_COUNT; from += CHUNK) {
    const to = Math.min(SPECIES_COUNT, from + CHUNK - 1);
    console.log(`Species ${from}–${to}…`);
    const { s } = await gql<{ s: RawDetail[] }>(DETAIL_QUERY(from, to));
    for (const sp of s) {
      const base = sp.varieties.find((v) => v.is_default) ?? sp.varieties[0];
      const baseStats = statsOf(base);
      const baseTypes = base.types.map((t) => t.t.name).join("/");

      // Group identical Pokédex entries across games.
      const entries: { text: string; games: string[] }[] = [];
      for (const f of sp.flavor) {
        const text = decapitalize(clean(f.flavor_text));
        const game = titleCase(f.v.name);
        const existing = entries.find((e) => e.text.toLowerCase() === text.toLowerCase());
        if (existing) {
          if (!existing.games.includes(game)) existing.games.push(game);
        } else entries.push({ text, games: [game] });
      }

      // Alternate forms worth showing: different typing/stats, or Gigantamax.
      const forms = sp.varieties
        .filter((v) => !v.is_default)
        .filter((v) => {
          const types = v.types.map((t) => t.t.name).join("/");
          const sameStats = JSON.stringify(statsOf(v)) === JSON.stringify(baseStats);
          return types !== baseTypes || !sameStats || v.name.endsWith("-gmax");
        })
        .map((v) => ({
          id: v.id,
          slug: v.name,
          name: v.forms[0]?.n[0]?.pokemon_name || titleCase(v.name),
          types: v.types.map((t) => t.t.name),
          stats: statsOf(v),
          abilities: abilitiesOf(v),
        }));

      const evYield = Object.fromEntries(
        base.stats.filter((st) => st.effort > 0).map((st) => [STAT_KEYS[st.s.name], st.effort])
      );

      details[sp.id] = {
        id: sp.id,
        captureRate: sp.capture_rate,
        baseHappiness: sp.base_happiness,
        genderRate: sp.gender_rate,
        hatchCounter: sp.hatch_counter,
        isBaby: sp.is_baby,
        genderDifferences: sp.has_gender_differences,
        growthRate: sp.growth ? titleCase(sp.growth.name) : null,
        eggGroups: sp.eggs.map((e) => titleCase(e.g.name)),
        baseExp: base.base_experience,
        evYield,
        abilities: abilitiesOf(base),
        evolution: mergeLocations(sp.evo),
        entries,
        dexNumbers: sp.dex
          .filter((d) => d.d.is_main_series && d.d.name !== "national")
          .map((d) => ({ dex: titleCase(d.d.name), number: d.pokedex_number })),
        forms,
        learnset: null as null | { game: string; moves: [number, string, number, string?][] },
      };
    }
  }

  // --- moves table ----------------------------------------------------------
  console.log("Moves…");
  const { m: rawMoves } = await gql<{ m: RawMove[] }>(`{
    m: pokemon_v2_move(order_by: { id: asc }) {
      id name power accuracy pp priority move_effect_chance generation_id
      type: pokemon_v2_type { name }
      cls: pokemon_v2_movedamageclass { name }
      eff: pokemon_v2_moveeffect { t: pokemon_v2_moveeffecteffecttexts(where: { language_id: { _eq: 9 } }) { short_effect } }
      flav: pokemon_v2_moveflavortexts(where: { language_id: { _eq: 9 } }, order_by: { version_group_id: desc }, limit: 1) { flavor_text }
      names: pokemon_v2_movenames(where: { language_id: { _eq: 9 } }) { name }
      mach: pokemon_v2_machines(where: { version_group_id: { _in: [25, 20, 23, 18, 19] } }) { version_group_id item: pokemon_v2_item { name } }
    }
  }`);

  const machines = new Map<string, string>(); // `${group}:${move}` -> "TM126"
  const moves: Record<number, unknown> = {};
  for (const mv of rawMoves) {
    const effect = mv.eff?.t[0]?.short_effect ?? mv.flav[0]?.flavor_text ?? "";
    moves[mv.id] = {
      name: mv.names[0]?.name ?? titleCase(mv.name),
      type: mv.type?.name ?? "normal",
      cls: mv.cls?.name ?? "status",
      power: mv.power,
      accuracy: mv.accuracy,
      pp: mv.pp,
      priority: mv.priority,
      gen: mv.generation_id,
      effect: clean(effect.replace(/\$effect_chance/g, String(mv.move_effect_chance ?? ""))),
    };
    for (const m of mv.mach) machines.set(`${m.version_group_id}:${mv.id}`, m.item.name.toUpperCase());
  }

  // --- learnsets: newest game each Pokémon appears in ---------------------------
  let missing = Object.keys(details).map(Number);
  for (const game of GAMES) {
    if (missing.length === 0) break;
    console.log(`Learnsets: ${game.label} (${missing.length} species left)…`);
    const rows = await fetchLearnsets(game.groups, missing);
    const byPokemon = new Map<number, RawLearn[]>();
    for (const r of rows) {
      const list = byPokemon.get(r.pokemon_id) ?? [];
      list.push(r);
      byPokemon.set(r.pokemon_id, list);
    }
    const machineGroup = game.groups[0];
    for (const [pid, list] of byPokemon) {
      const seen = new Set<string>();
      const learn: [number, string, number, string?][] = [];
      for (const r of list) {
        const method = METHOD_CODE[r.move_learn_method_id];
        const key = `${r.move_id}:${method}:${method === "L" ? r.level : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tm = method === "M" ? machines.get(`${machineGroup}:${r.move_id}`) : undefined;
        learn.push(tm ? [r.move_id, method, r.level, tm] : [r.move_id, method, r.level]);
      }
      learn.sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2] || a[0] - b[0]);
      (details[pid] as { learnset: unknown }).learnset = { game: game.label, moves: learn };
    }
    missing = missing.filter((id) => !byPokemon.has(id));
  }
  if (missing.length) console.warn(`No learnset found for ${missing.length} species: ${missing.slice(0, 20).join(", ")}`);

  fs.writeFileSync(path.join(DATA_DIR, "pokedex-details.json"), JSON.stringify(details));
  fs.writeFileSync(path.join(DATA_DIR, "moves.json"), JSON.stringify(moves));
  const kb = (f: string) => Math.round(fs.statSync(path.join(DATA_DIR, f)).size / 1024);
  console.log(`✓ pokedex-details.json (${kb("pokedex-details.json")} KB), moves.json (${kb("moves.json")} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
