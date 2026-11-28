/**
 * PokéAPI location-area encounters -> Rows for one game's versions.
 *
 * Within one (area, Pokémon, version, method, non-time conditions) the slot chances are summed per time of day
 * (Gen 2/4) or season (Gen 5); slots with equal totals share one row whose condition names them.
 */
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";
import { accent, cleanPlace, subArea } from "./areas";
import { getJson, pool } from "./fetch";
import { enName, idOf, loadAll, type ApiLocation, type ApiLocationArea } from "./pokeapi";
import type { Row } from "./rows";

/** PokéAPI encounter method -> kind and label; null = not a game encounter (event distributions, other games). */
export const API_METHOD: Record<string, { kind: EncounterKind; label: string } | null> = {
  // PokéAPI doesn't say grass, cave or building: the terrain comes from Bulbapedia's table in the merge step.
  walk: { kind: "wild", label: "Walking" },
  surf: { kind: "wild", label: "Surf" },
  "old-rod": { kind: "wild", label: "Old Rod" },
  "good-rod": { kind: "wild", label: "Good Rod" },
  "super-rod": { kind: "wild", label: "Super Rod" },
  "rock-smash": { kind: "wild", label: "Rock Smash" },
  headbutt: { kind: "wild", label: "Headbutt" },
  "headbutt-low": { kind: "wild", label: "Headbutt (low encounter rate tree)" },
  "headbutt-normal": { kind: "wild", label: "Headbutt" },
  "headbutt-high": { kind: "wild", label: "Headbutt (high encounter rate tree)" },
  "honey-tree": { kind: "wild", label: "Honey Tree" },
  "dark-grass": { kind: "wild", label: "Dark Grass" },
  "grass-spots": { kind: "wild", label: "Rustling Grass" },
  "cave-spots": { kind: "wild", label: "Dust Cloud" },
  "bridge-spots": { kind: "wild", label: "Flying Pokémon's Shadow" },
  "super-rod-spots": { kind: "wild", label: "Super Rod (rippling water)" },
  "surf-spots": { kind: "wild", label: "Surf (rippling water)" },
  "yellow-flowers": { kind: "wild", label: "Yellow Flowers" },
  "purple-flowers": { kind: "wild", label: "Purple Flowers" },
  "red-flowers": { kind: "wild", label: "Red Flowers" },
  "rough-terrain": { kind: "wild", label: "Rough Terrain" },
  horde: { kind: "wild", label: "Horde" },
  "berry-trees": { kind: "wild", label: "Berry Tree" },
  "berry-piles": { kind: "wild", label: "Berry Pile" },
  sos: { kind: "wild", label: "SOS Battle" },
  "sos-encounter": { kind: "wild", label: "SOS Battle" },
  "sos-from-bubbling-spot": { kind: "wild", label: "SOS Battle (bubbling spot)" },
  "bubbling-spots": { kind: "wild", label: "Fishing (bubbling spot)" },
  "island-scan": { kind: "wild", label: "Island Scan" },
  seaweed: { kind: "wild", label: "Dive (seaweed)" },
  "feebas-tile-fishing": { kind: "wild", label: "Fishing (Feebas tile)" },
  "ceiling-ambush": { kind: "static", label: "Ambush (ceiling)" },
  "ground-ambush": { kind: "static", label: "Ambush (ground)" },
  "sky-ambush": { kind: "static", label: "Ambush (sky)" },
  "trash-can-ambush": { kind: "static", label: "Ambush (trash can)" },
  "rustling-bush-ambush": { kind: "static", label: "Ambush (rustling bush)" },
  static: { kind: "static", label: "Static" },
  "only-one": { kind: "static", label: "Static" },
  pokeflute: { kind: "static", label: "Poké Flute" },
  "squirt-bottle": { kind: "static", label: "Squirt Bottle" },
  "wailmer-pail": { kind: "static", label: "Wailmer Pail" },
  "devon-scope": { kind: "static", label: "Devon Scope" },
  "hidden-grotto": { kind: "static", label: "Hidden Grotto" },
  gift: { kind: "gift", label: "Gift" },
  "gift-egg": { kind: "egg", label: "Egg" },
  "npc-trade": { kind: "trade", label: "Trade" },
  "roaming-grass": { kind: "roaming", label: "Roaming (grass)" },
  "roaming-water": { kind: "roaming", label: "Roaming (water)" },
  overworld: { kind: "wild", label: "Overworld" },
  "overworld-special": { kind: "wild", label: "Overworld (rare spawn)" },
  "overworld-water": { kind: "wild", label: "Overworld (water)" },
  "overworld-water-special": { kind: "wild", label: "Overworld (water, rare spawn)" },
  "overworld-flying": { kind: "wild", label: "Overworld (sky)" },
  "overworld-flying-special": { kind: "wild", label: "Overworld (sky, rare spawn)" },
  "overworld-dirt": { kind: "wild", label: "Overworld (underground)" },
  wanderer: { kind: "wild", label: "Wanderer" },
  "wanderer-water": { kind: "wild", label: "Wanderer (water)" },
  "chase-water": { kind: "wild", label: "Chase (water)" },
  "max-raid": { kind: "wild", label: "Max Raid Battle" },
  "dynamax-adventure": { kind: "static", label: "Dynamax Adventure" },
  // Event distributions and the GameCube games: not encounters in these games.
  "colosseum-bonus-disc-jpn": null,
  "colosseum-bonus-disc-us": null,
  "pokemon-channel-pal": null,
  "pokemon-ranger": null,
  snag: null,
  "snag-rematch": null,
  pokespot: null,
};

/** Conditions that describe the ordinary case. */
const PLAIN_COND = new Set(["swarm-no", "radar-off", "radio-off", "slot2-none", "bug-catching-contest-no", "johto-safari-blocks-inactive", "backlot-not-mentioned", "great-marsh-daily-slot-none", "weather-normal"]);
const FOSSIL = /^item-(.*fossil|old-amber|fossilized-.*)$/;
const TIME: Record<string, number> = { "time-morning": 0, "time-day": 1, "time-night": 2 };
const TIME_NAMES = ["Morning", "Day", "Night"];
const SEASON: Record<string, number> = { "season-spring": 0, "season-summer": 1, "season-autumn": 2, "season-winter": 3 };
const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"];
/** Methods whose PokéAPI chance is not an encounter rate. */
const NO_RATE = new Set(["static", "only-one", "gift", "gift-egg", "npc-trade", "pokeflute", "squirt-bottle", "wailmer-pail", "devon-scope", "honey-tree", "roaming-grass", "roaming-water", "hidden-grotto", "dynamax-adventure", "ceiling-ambush", "ground-ambush", "sky-ambush", "trash-can-ambush", "rustling-bush-ambush", "island-scan"]);
/** Conditions that pool alternative tables, so a summed chance is no rate. */
const NO_RATE_COND = /^(great-marsh-daily-slot-|johto-safari-blocks-|friend-safari-slot-|max-den-)/;

let condNames: Map<string, string> | null = null;
async function conditionNames(): Promise<Map<string, string>> {
  if (condNames) return condNames;
  const list = await getJson<{ results: { name: string; url: string }[] }>("pokeapi/encounter-condition-value-list", "https://pokeapi.co/api/v2/encounter-condition-value?limit=500");
  const m = new Map<string, string>();
  await pool(list!.results, 8, async (r) => {
    const v = await getJson<{ names: { name: string; language: { name: string } }[] }>(`pokeapi/encounter-condition-value/${r.name}`, r.url);
    const n = v?.names.find((x) => x.language.name === "en")?.name;
    if (n && n !== "?") m.set(r.name, accent(n.replace(/’/g, "'")));
  });
  condNames = m;
  return m;
}

/** Species of a PokéAPI pokemon (forms have ids above 10000 and point at their species). */
const speciesMemo = new Map<number, number>();
async function speciesOf(pokemonUrl: string): Promise<number> {
  const id = idOf(pokemonUrl);
  if (id <= 10000) return id;
  const hit = speciesMemo.get(id);
  if (hit) return hit;
  const p = await getJson<{ species: { url: string } }>(`pokeapi/pokemon/${id}`, pokemonUrl);
  const s = idOf(p!.species.url);
  speciesMemo.set(id, s);
  return s;
}

export interface ApiData {
  areas: ApiLocationArea[];
  locations: Map<number, ApiLocation>;
}
let cache: ApiData | null = null;
export async function apiData(): Promise<ApiData> {
  return (cache ??= await loadAll());
}

/** Rows for the PokéAPI versions in `vmap` (PokéAPI version -> our version id). */
export async function pokeapiRows(vmap: Record<string, string>): Promise<{ rows: Row[]; skipped: string[] }> {
  const { areas, locations } = await apiData();
  const names = await conditionNames();
  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const a of areas) {
    const loc = locations.get(idOf(a.location.url));
    const hasVer = a.pokemon_encounters.some((pe) => pe.version_details.some((vd) => vmap[vd.version.name]));
    if (!hasVer) continue;
    const locEn = enName(loc?.names);
    if (!loc || !locEn) {
      skipped.push(`location-area ${a.name}: its location has no English name`);
      continue;
    }
    const place = cleanPlace(locEn);
    const sub = subArea(place, enName(a.names), a.name, loc.name);
    const url = `https://pokeapi.co/api/v2/location-area/${a.id}/`;
    for (const pe of a.pokemon_encounters) {
      const pid = idOf(pe.pokemon.url);
      const species = await speciesOf(pe.pokemon.url);
      const form = pid > 10000 ? pe.pokemon.name : undefined;
      for (const vd of pe.version_details) {
        const ver = vmap[vd.version.name];
        if (!ver) continue;
        // (method, other conditions) -> per-slot chance sums
        const groups = new Map<string, { method: string; conds: string[]; lo: number; hi: number; slots: number[]; slotKind: "time" | "season" | "none"; sum: number; pooled: boolean }>();
        for (const d of vd.encounter_details) {
          const m = API_METHOD[d.method.name];
          if (m === null) continue;
          if (m === undefined) throw new Error(`unmapped PokéAPI method ${d.method.name} (${a.name})`);
          const cv = d.condition_values.map((c) => c.name);
          const times = cv.filter((c) => c in TIME).map((c) => TIME[c]);
          const seasons = cv.filter((c) => c in SEASON).map((c) => SEASON[c]);
          const other = cv.filter((c) => !(c in TIME) && !(c in SEASON) && !PLAIN_COND.has(c)).sort();
          const key = `${d.method.name}|${other.join(",")}`;
          const slotKind = times.length ? "time" : seasons.length ? "season" : "none";
          const g = groups.get(key) ?? { method: d.method.name, conds: other, lo: 999, hi: 0, slots: [0, 0, 0, 0], slotKind, sum: 0, pooled: false };
          if (g.slotKind === "none" && slotKind !== "none") g.slotKind = slotKind;
          g.lo = Math.min(g.lo, d.min_level);
          g.hi = Math.max(g.hi, d.max_level);
          g.pooled ||= other.some((c) => NO_RATE_COND.test(c));
          const n = slotKind === "time" ? 3 : 4;
          const hit = slotKind === "time" ? times : slotKind === "season" ? seasons : [0, 1, 2, 3].slice(0, n);
          // A detail without a time/season condition counts in every slot.
          for (const s of slotKind === "none" ? [0, 1, 2, 3] : hit) g.slots[s] += d.chance;
          g.sum += d.chance;
          groups.set(key, g);
        }
        for (const g of groups.values()) {
          const m = API_METHOD[g.method]!;
          let kind = m.kind;
          let method = m.label;
          const fossil = g.conds.find((c) => FOSSIL.test(c));
          if (kind === "gift" && fossil) {
            kind = "fossil";
            method = "Fossil";
          }
          const condText = g.conds.map((c) => names.get(c) ?? c).join("; ");
          const base: Omit<Row, "rate" | "cond"> = { src: "pokeapi", ver, place, ...(sub ? { sub } : {}), species, ...(form ? { form, art: pid } : {}), kind, method, url };
          if (g.method !== "npc-trade") base.levels = [g.lo, g.hi];
          const rated = !NO_RATE.has(g.method) && !g.pooled;
          const nSlots = g.slotKind === "time" ? 3 : g.slotKind === "season" ? 4 : 1;
          const slots = g.slots.slice(0, nSlots);
          const byRate = new Map<number, number[]>();
          slots.forEach((v, i) => {
            if (v > 0) byRate.set(v, [...(byRate.get(v) ?? []), i]);
          });
          const labels = g.slotKind === "time" ? TIME_NAMES : SEASON_NAMES;
          for (const [rate, idx] of byRate) {
            const when = g.slotKind === "none" || idx.length === nSlots ? "" : idx.map((i) => labels[i]).join(", ");
            const cond = [when, condText].filter(Boolean).join("; ");
            rows.push({ ...base, ...(rated && rate <= 100 ? { rate } : {}), ...(cond ? { cond } : {}) });
          }
        }
      }
    }
  }
  return { rows, skipped };
}
