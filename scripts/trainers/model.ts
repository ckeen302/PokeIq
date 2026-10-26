import type { TrainerArea, TrainerGameFile, TrainerMon, TrainerTeam } from "../../src/lib/trainers/types";
import { areaSlug } from "./common";

export interface RawPlace {
  area: string;
  section?: string;
  region: string;
}

/** What each per-generation importer produces before areas are indexed. */
export interface RawTeam {
  id: string;
  /** Decomp class constant (for notable matching). */
  clsConst: string;
  cls: string;
  name?: string;
  places: RawPlace[];
  tag?: string;
  /** Group key shared by one trainer's battles (rematches, rival variants). */
  group?: string;
  ver?: string[];
  double?: boolean;
  items?: string[];
  team: TrainerMon[];
}

/** Index areas, drop duplicate spots and sort teams by area then class. */
export function assemble(game: string, source: TrainerGameFile["source"], raw: RawTeam[], notableOf: (t: RawTeam) => string | undefined): TrainerGameFile {
  const areas: TrainerArea[] = [];
  const areaIdx = new Map<string, number>();
  const idxOf = (p: RawPlace) => {
    const key = `${p.region}|${p.area}`;
    let i = areaIdx.get(key);
    if (i === undefined) {
      let slug = areaSlug(p.area);
      if (areas.some((a) => a.slug === slug)) slug = `${slug}-${areaSlug(p.region)}`;
      i = areas.push({ slug, name: p.area, region: p.region }) - 1;
      areaIdx.set(key, i);
    }
    return i;
  };
  const seen = new Set<string>();
  const teams: TrainerTeam[] = raw.map((t) => {
    if (seen.has(t.id)) throw new Error(`Duplicate team id ${t.id}`);
    seen.add(t.id);
    const at: TrainerTeam["at"] = [];
    for (const p of t.places) {
      const a = idxOf(p);
      if (!at.some((x) => x.a === a && x.s === p.section)) at.push(p.section ? { a, s: p.section } : { a });
    }
    const n = notableOf(t);
    return {
      id: t.id,
      cls: t.cls,
      ...(t.name ? { name: t.name } : {}),
      at,
      ...(t.group && t.group !== t.id ? { g: t.group } : {}),
      ...(t.tag ? { tag: t.tag } : {}),
      ...(t.ver?.length ? { ver: t.ver } : {}),
      ...(t.double ? { double: 1 as const } : {}),
      ...(t.items?.length ? { items: t.items } : {}),
      team: t.team,
      ...(n ? { n } : {}),
    };
  });
  return { game, source, areas, teams };
}
