import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getItem, getMove, species } from "@/lib/dex/data";
import { getPlace } from "@/lib/dex/places-data";
import { placeSlug } from "@/lib/dex/places";
import { TRAINER_GAMES, trainerGame } from "./games";
import { NOTABLE, notable } from "./notable";
import type { TrainerArea, TrainerGameFile, TrainerTeam } from "./types";
import { areaKind, AREA_KINDS, compareAreas, teamTitle, type AreaKind } from "./format";

const DIR = path.join(process.cwd(), "src/data/trainers");
const CACHE = new Map<string, TrainerGameFile>();

/** One game's trainer file (read once per build worker). */
export function gameFile(key: string): TrainerGameFile | undefined {
  if (!trainerGame(key)) return undefined;
  let f = CACHE.get(key);
  if (!f) {
    f = JSON.parse(fs.readFileSync(path.join(DIR, `${key}.json`), "utf8")) as TrainerGameFile;
    CACHE.set(key, f);
  }
  return f;
}

export interface AreaSummary extends TrainerArea {
  kind: AreaKind;
  count: number;
  notables: string[];
}

/** Areas of a game with their trainer counts, grouped by region then kind. */
export function gameAreas(key: string): { region: string; groups: { kind: AreaKind; areas: AreaSummary[] }[] }[] {
  const f = gameFile(key);
  if (!f) return [];
  const sums: AreaSummary[] = f.areas.map((a) => ({ ...a, kind: areaKind(a.name), count: 0, notables: [] }));
  for (const t of f.teams)
    for (const a of new Set(t.at.map((s) => s.a))) {
      sums[a].count++;
      if (t.n && !sums[a].notables.includes(t.n)) sums[a].notables.push(t.n);
    }
  const regions = trainerGame(key)!.regions;
  return regions
    .map((region) => ({
      region,
      groups: AREA_KINDS.map((kind) => ({ kind, areas: sums.filter((s) => s.region === region && s.kind === kind && s.count).sort(compareAreas) })).filter((g) => g.areas.length),
    }))
    .filter((r) => r.groups.length);
}

export interface TrainerGroup {
  key: string;
  title: string;
  cls: string;
  name?: string;
  n?: string;
  teams: TrainerTeam[];
}

/** Teams fought in an area, by floor/section, with one trainer's battles (first, rematches, rival variants) grouped together. */
export function areaTeams(key: string, slug: string): { area: TrainerArea; sections: { name: string | null; trainers: TrainerGroup[] }[] } | null {
  const f = gameFile(key);
  const idx = f?.areas.findIndex((a) => a.slug === slug) ?? -1;
  if (!f || idx < 0) return null;
  const sections = new Map<string | null, Map<string, TrainerGroup>>();
  for (const t of f.teams) {
    for (const s of t.at) {
      if (s.a !== idx) continue;
      const sec = s.s ?? null;
      if (!sections.has(sec)) sections.set(sec, new Map());
      const groups = sections.get(sec)!;
      // Named trainers group by name; unnamed Gen I trainers stay one card per party.
      const gk = t.g ?? t.id;
      if (!groups.has(gk)) groups.set(gk, { key: t.id, title: teamTitle(t), cls: t.cls, name: t.name, n: t.n, teams: [] });
      groups.get(gk)!.teams.push(t);
    }
  }
  const ordered = [...sections.entries()].sort((a, b) => (a[0] === null ? -1 : b[0] === null ? 1 : a[0].localeCompare(b[0], "en", { numeric: true })));
  return { area: f.areas[idx], sections: ordered.map(([name, g]) => ({ name, trainers: [...g.values()] })) };
}

/** Every team of a notable trainer, per game in release order. */
export function notableTeams(slug: string): { game: string; teams: (TrainerTeam & { places: { area: TrainerArea; section?: string }[] })[] }[] {
  return TRAINER_GAMES.flatMap((g) => {
    const f = gameFile(g.key)!;
    const teams = f.teams.filter((t) => t.n === slug).map((t) => ({ ...t, places: t.at.map((s) => ({ area: f.areas[s.a], section: s.s })) }));
    return teams.length ? [{ game: g.key, teams }] : [];
  });
}

/** Notables that appear in at least one imported game, with the games. */
export function notableDirectory() {
  const games = new Map<string, string[]>();
  for (const g of TRAINER_GAMES) for (const t of gameFile(g.key)!.teams) if (t.n) games.set(t.n, [...new Set([...(games.get(t.n) ?? []), g.key])]);
  return NOTABLE.filter((n) => games.has(n.slug)).map((n) => ({ ...n, games: games.get(n.slug)! }));
}

/** Atlas / Places names that differ from the in-game area names. */
const PLACE_ALIAS: Record<string, string> = {
  "Rocket Hideout|Kanto": "Team Rocket Hideout",
  "Oak's Lab|Kanto": "Professor Oak's Laboratory",
  "Pokémon Mansion|Kanto": "Pokémon Mansion (Kanto)",
  "Lighthouse|Johto": "Olivine Lighthouse",
  "Celadon Game Corner|Kanto": "Celadon Game Corner",
  "Mt. Silver Cave|Kanto": "Mt. Silver",
};

/** Our Places page for an area, when one matches by name and region. */
export function placeFor(area: TrainerArea): { slug: string; atlas: boolean; name: string } | null {
  const names = [PLACE_ALIAS[`${area.name}|${area.region}`], area.name, area.name.replace(/’/g, "'")].filter(Boolean) as string[];
  const regions = area.region === "Sevii Islands" ? ["Sevii Islands", "Kanto"] : [area.region];
  for (const name of names)
    for (const region of regions) {
      const p = getPlace(placeSlug({ name, region }));
      if (p) return { slug: p.slug, atlas: p.atlas, name: p.name };
    }
  return null;
}

export const speciesOf = species;
export const moveName = (slug: string) => getMove(slug)?.name ?? null;
/** Our item page for a stored item ref (slug), or null when the ref is an in-game name we don't have. */
export const itemOf = (ref: string) => getItem(ref) ?? null;

/** Compact rows for the client-side search, built at build time. */
export function searchRows() {
  const rows: (string | number | number[] | null)[][] = [];
  TRAINER_GAMES.forEach((g, gi) => {
    const f = gameFile(g.key)!;
    for (const t of f.teams) {
      const a = t.at[0] ? f.areas[t.at[0].a] : null;
      if (!a) continue;
      rows.push([gi, a.slug, a.name, a.region, t.cls, t.name ?? null, t.tag ?? null, t.n ?? null, t.id, Math.max(...t.team.map((m) => m.lv)), t.team.map((m) => m.s)]);
    }
  });
  const ids = new Set(rows.flatMap((r) => r[10] as number[]));
  const names: Record<number, string> = {};
  for (const id of ids) names[id] = species(id)?.name ?? `#${id}`;
  return { rows, species: names };
}

/** Game, area and notable trainer pages for the sitemap. */
export function trainerSitemapPaths(): { path: string; priority: number }[] {
  const out: { path: string; priority: number }[] = [];
  for (const g of TRAINER_GAMES) {
    out.push({ path: `/pokedex/trainers/${g.key}`, priority: 0.5 });
    const f = gameFile(g.key)!;
    for (const a of f.areas) out.push({ path: `/pokedex/trainers/${g.key}/${a.slug}`, priority: 0.3 });
  }
  for (const n of notableDirectory()) out.push({ path: `/pokedex/trainers/notable/${n.slug}`, priority: 0.5 });
  return out;
}

export { notable };
