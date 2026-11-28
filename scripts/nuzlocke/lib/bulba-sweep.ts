/**
 * Bulbapedia's location pages for a game ("Category:Emerald locations") that no area's own page lookup reached: a
 * building inside a town (Devon Corporation in Rustboro City), a part of an area (Mirage Cave (north of Fallarbor
 * Town)), or a place neither PokéAPI nor Serebii has (Omega Ruby/Alpha Sapphire's Dewford Town, Brilliant
 * Diamond/Shining Pearl's Hearthome City). Each page with this game's table rows is placed: into an area (by an
 * explicit rule, by its title, or by its infobox's `location`), or as an area of its own.
 */
import { placeKey } from "./areas";
import { catchRows, specialBoxes, type BulbaRow } from "./bulba-catch";
import { categoryMembers, pages, pageUrl, plain } from "./bulbapedia";
import type { GameCfg } from "./config";

export interface SweepRule {
  /** Fold into this area (its name). */
  into?: string;
  /** The part of that area the page is. */
  sub?: string;
  /** Leave the page out, and why. */
  skip?: string;
  why?: string;
}

/**
 * Pages the title and infobox can't place: per game, page title -> rule. Every rule says why.
 */
export const SWEEP_RULES: Record<string, Record<string, SweepRule>> = Object.fromEntries(
  [
    ...["gold-silver", "crystal", "heartgold-soulsilver"].map((g) => [g, { "Mt. Silver Cave": { into: "Mt. Silver", why: "the cave inside Mt. Silver: PokéAPI and the walkthrough count it as Mt. Silver" } }] as const),
    ...["ruby-sapphire", "emerald", "omega-ruby-alpha-sapphire"].map((g) => [g, { Underwater: { skip: "not one place: Dive spots under several routes (each route's page lists its own)" } }] as const),
    ["black-2-white-2", { "Hidden Grotto": { skip: "not one place: each route's page lists its own Hidden Grotto" } }] as const,
    ["ultra-sun-ultra-moon", { "Aether Paradise": { skip: "its only row is Ancient Poni Path's Type: Null, given here instead only when the party and boxes were full then (Bulbapedia's note)" } }] as const,
    ["omega-ruby-alpha-sapphire", { Underwater: { skip: "not one place: Dive spots under several routes (each route's page lists its own)" }, "Contest Hall": { skip: "the Cosplay Pikachu is given in the Contest Halls of four towns, which their own pages list" } }] as const,
  ].reduce<[string, Record<string, SweepRule>][]>((acc, [g, r]) => {
    const hit = acc.find(([x]) => x === g);
    if (hit) Object.assign(hit[1], r);
    else acc.push([g, { ...r }]);
    return acc;
  }, []),
);

export interface SweepPage {
  title: string;
  url: string;
  /** This game's catch rows on the page (its versions only). */
  rows: BulbaRow[];
  boxes: number[];
  /** The area (key) it folds into; undefined = a place of its own. */
  into?: string;
  sub?: string;
  /** The place's name, for a place of its own (the infobox's location name, else the title without "(Region)"). */
  name: string;
  how: string;
}

const REGION = /^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Sevii Islands) /;
const REGION_Q = /\s*\((Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Generation [IVX]+|town|city|location)\)\s*$/i;
/** An infobox location that says where the place is relative to another, or that it is all over. */
const NOT_INSIDE = /^\s*((north|south|east|west|northeast|northwest|southeast|southwest)(ern)?\s+(of|part of|end of)\b|between\b|near\b|next to\b|outside\b|beneath\b|under\b|below\b|above\b|atop\b|off\b|throughout\b|across\b|all over\b|various\b)/i;

export async function categorySweep(cfg: GameCfg, used: Set<string>, areaNames: Map<string, string>): Promise<SweepPage[]> {
  if (!cfg.bulbaCategory) return [];
  const members = await categoryMembers(cfg.bulbaCategory);
  const todo = members.filter((t) => !used.has(t));
  const got = await pages(todo);
  const tpl = new Set(cfg.bulba);
  const vers = new Set(cfg.versions.map((v) => v.id));
  const rules = SWEEP_RULES[cfg.id] ?? {};
  type Cand = { title: string; url: string; rows: BulbaRow[]; boxes: number[]; name: string; loc: string; rule?: SweepRule };
  const cands: Cand[] = [];
  for (const t of todo) {
    const p = got.get(t);
    if (!p?.text || !p.title || used.has(p.title) || cands.some((c) => c.title === p.title)) continue;
    const rows = catchRows(p.text)
      .filter((r) => tpl.has(r.tpl))
      .map((r) => ({ ...r, versions: r.versions.filter((v) => vers.has(v)) }))
      .filter((r) => r.versions.length && Number.isInteger(r.species) && r.species > 0);
    if (!rows.length) continue;
    const rule = rules[p.title];
    if (rule?.skip) continue;
    const locName = /^\|\s*location_name\s*=(.*)$/m.exec(p.text)?.[1];
    const name = (locName && plain(locName)) || p.title.replace(REGION_Q, "");
    cands.push({ title: p.title, url: pageUrl(p.title), rows, boxes: specialBoxes(p.text), name, loc: /^\|\s*location\s*=(.*)$/m.exec(p.text)?.[1] ?? "", rule });
  }
  // Where each page goes, against the areas the sources name plus (second pass) the new places among these pages, so a
  // building of a new town (Oreburgh Mining Museum in Brilliant Diamond's Oreburgh City) joins that town.
  const place = (c: Cand, names: Map<string, string>, self?: string): Omit<SweepPage, "title" | "url" | "rows" | "boxes" | "name"> | null => {
    // `self`: in the second pass, the page's own new place, which it can't fold into.
    const areaOf = (n: string): string | undefined => {
      for (const x of [n, n.replace(REGION, ""), n.replace(REGION_Q, "")]) if (names.has(placeKey(x)) && placeKey(x) !== self) return placeKey(x);
      return undefined;
    };
    if (c.rule?.into) {
      const k = areaOf(c.rule.into);
      if (!k) throw new Error(`${cfg.id}: sweep rule for ${c.title} names no area (${c.rule.into})`);
      return { into: k, ...(c.rule.sub ? { sub: c.rule.sub } : {}), how: `rule: ${c.rule.why}` };
    }
    // By title: "Mirage Cave (north of Fallarbor Town)" is a part of Mirage Cave; "Five Island (town)" is Five Island.
    const q = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(c.title);
    const byTitle = (names.has(placeKey(c.title)) && placeKey(c.title) !== self ? placeKey(c.title) : undefined) ?? (q ? areaOf(q[1]) : undefined);
    if (byTitle) {
      const sub = q && !REGION_Q.test(c.title) ? q[2][0].toUpperCase() + q[2].slice(1) : undefined;
      return { into: byTitle, ...(sub ? { sub } : {}), how: "title" };
    }
    // By the infobox: a building's location is the town it stands in ("[[Rustboro City]]").
    if (!NOT_INSIDE.test(plain(c.loc))) {
      const links = [...c.loc.matchAll(/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]|\{\{rtn?\|(\d+)\|([^|}]+)\}\}/g)].map((m) => (m[1] ? m[1].trim() : `Route ${m[2]}`));
      const k = links.map(areaOf).find(Boolean);
      if (k) return { into: k, sub: c.name, how: `infobox location: ${plain(c.loc)}` };
    }
    return null;
  };
  const placed = cands.map((c) => ({ c, p: place(c, areaNames) }));
  const withNew = new Map(areaNames);
  for (const { c, p } of placed) if (!p) withNew.set(placeKey(c.name), c.name);
  const out: SweepPage[] = [];
  for (const { c, p } of placed) {
    const again = p ?? place(c, withNew, placeKey(c.name));
    out.push({ title: c.title, url: c.url, rows: c.rows, boxes: c.boxes, name: c.name, ...(again ?? { how: `a place of its own (infobox location: ${plain(c.loc) || "none"})` }) });
  }
  // New places first, so the pages folding into them find them.
  return out.sort((a, b) => Number(!!a.into) - Number(!!b.into));
}
