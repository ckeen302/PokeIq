import { DEFAULT_PRESET, PRESET_BY_ID, predicted } from "./presets";
import { DEFAULT_SEED, knockout, type Tournament } from "./tournament";
import { vsOk } from "./deeplink";
import type { Distance } from "./track";
import type { Entrant } from "./types";

/**
 * Which race /pokedex/race runs, from what the page was opened with (a
 * preset, a ?vs= field, a distance, a tournament seed). Client-safe and
 * unit-tested.
 */

export interface RaceSpec {
  preset: string;
  /** A custom field (2–8 keys) replaces the preset's. */
  vs: string[];
  distance: Distance;
  seed: number;
}

export function specFor(preset: string, vs: string[] = [], distance?: Distance | null, seed?: number | null): RaceSpec {
  const p = PRESET_BY_ID.get(preset) ?? DEFAULT_PRESET;
  return { preset: p.id, vs, distance: distance ?? p.distance, seed: seed ?? DEFAULT_SEED };
}

export interface Field {
  entrants: Entrant[];
  /** The knockout behind "Every Pokémon" (its final is the field). */
  tournament: Tournament | null;
  title: string;
  hook: string;
}

const tournaments = new Map<string, Tournament>();

/** A Pokémon's heat: it and the seven Pokémon closest to it over the distance (the "Race it" link on its Pokédex entry). */
export function heatFor(e: Entrant, all: Entrant[], d: Distance): Entrant[] {
  const me = predicted(e, d);
  const others = all
    .filter((x) => x.kind === "pokemon" && x.key !== e.key)
    .map((x) => ({ x, gap: Math.abs(predicted(x, d) - me) }))
    .sort((a, b) => a.gap - b.gap || a.x.species - b.x.species)
    .slice(0, 7)
    .map((o) => o.x);
  return [e, ...others];
}

export function fieldFor(spec: RaceSpec, all: Entrant[]): Field {
  const byKey = new Map(all.map((e) => [e.key, e]));
  if (spec.vs.length === 1 && byKey.has(spec.vs[0])) {
    const e = byKey.get(spec.vs[0])!;
    return { entrants: heatFor(e, all, spec.distance), tournament: null, title: `${e.name}'s heat`, hook: `Can ${e.name} win its heat? 🏁` };
  }
  if (vsOk(spec.vs.length)) {
    const entrants = spec.vs.flatMap((k) => byKey.get(k) ?? []);
    const names = entrants.map((e) => e.name);
    return { entrants, tournament: null, title: names.join(" vs "), hook: `${names.join(" vs ")} 😳` };
  }
  const p = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  if (p.tournament) {
    const key = `${p.id}|${spec.distance}|${spec.seed}`;
    let t = tournaments.get(key);
    if (!t) {
      const field = p.pick(all, spec.distance).map((e) => ({ key: e.key, time: predicted(e, spec.distance) }));
      t = knockout(field, spec.seed);
      tournaments.set(key, t);
    }
    return { entrants: t.finalists.flatMap((k) => byKey.get(k) ?? []), tournament: t, title: `${p.label}: the final`, hook: p.hook };
  }
  return { entrants: p.pick(all, spec.distance), tournament: null, title: p.label, hook: p.hook };
}

/** Folds case and accents: "Flabébé" → "flabebe". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pokémon and forms matching a search (name, Dex number or "#25"): exact names first, then prefixes, then the rest; species before forms. */
export function searchEntrants(all: Entrant[], query: string, limit = 8): Entrant[] {
  const q = fold(query.trim()).replace(/^#/, "");
  if (!q) return [];
  const num = /^\d+$/.test(q) ? Number(q) : null;
  const scored: { e: Entrant; s: number }[] = [];
  for (const e of all) {
    const name = fold(e.name);
    let s = -1;
    if (num !== null) s = e.species === num ? 0 : -1;
    else if (name === q || e.key === q) s = 0;
    else if (name.startsWith(q)) s = 2;
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) s = 3;
    else if (name.includes(q)) s = 4;
    if (s < 0) continue;
    if (e.kind !== "pokemon") s += 0.5;
    scored.push({ e, s });
  }
  scored.sort((a, b) => a.s - b.s || a.e.species - b.e.species || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}
