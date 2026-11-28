/**
 * Each area's Bulbapedia location page(s) and the rows of this game's encounter tables on them.
 */
import { catchRows, specialBoxes, type BulbaRow } from "./bulba-catch";
import { pages, pageUrl } from "./bulbapedia";
import { placeKey } from "./areas";

export interface BulbaLoc {
  title: string;
  url: string;
  /** Rows of this game's templates. */
  rows: BulbaRow[];
  /** Pokémon shown in the page's "Special encounters" boxes (one-time encounters with no table row). */
  boxes: number[];
}

/**
 * Find the page for each area: the walkthrough's own link for the name, then "{Region} {Name}", "{Name} ({Region})" and
 * "{Name}". A page counts only if its Pokémon section has a table of this game (so a disambiguation page never does).
 * `extra` adds explicit titles per area key (for places whose table is on another page).
 */
export async function bulbaPages(
  areaNames: Map<string, string>,
  opts: { templates: string[]; regions: string[]; links: Map<string, string>; extra?: Record<string, string[]> },
): Promise<Map<string, BulbaLoc[]>> {
  const linkByKey = new Map<string, string[]>();
  for (const [label, title] of opts.links) {
    const k = placeKey(label);
    if (!linkByKey.has(k)) linkByKey.set(k, []);
    if (!linkByKey.get(k)!.includes(title)) linkByKey.get(k)!.push(title);
  }
  const cands = new Map<string, string[]>();
  for (const [key, name] of areaNames) {
    const bare = name.replace(/\s*\([^)]*\)\s*$/, "");
    const list = [
      ...(opts.extra?.[key] ?? []),
      ...(linkByKey.get(key) ?? []),
      ...opts.regions.flatMap((r) => [`${r} ${bare}`, `${bare} (${r})`]),
      bare,
      name,
    ];
    cands.set(key, [...new Set(list)]);
  }
  const got = await pages([...new Set([...cands.values()].flat())]);
  const out = new Map<string, BulbaLoc[]>();
  const tpl = new Set(opts.templates);
  // A large area's page (Legends: Arceus's Obsidian Fieldlands) keeps its tables on the pages of its sublocations.
  const subs = new Map<string, string[]>();
  for (const p of got.values()) {
    if (!p?.text || !p.title || catchRows(p.text).some((r) => tpl.has(r.tpl))) continue;
    const m = /^==\s*Sublocations\s*==\s*$/m.exec(p.text);
    if (!m) continue;
    const rest = p.text.slice(m.index + m[0].length);
    const body = rest.slice(0, /^==[^=]/m.exec(rest)?.index ?? rest.length);
    subs.set(p.title, [...new Set([...body.matchAll(/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1].trim()))]);
  }
  const subPages = await pages([...new Set([...subs.values()].flat())]);
  for (const [key, list] of cands) {
    const found: BulbaLoc[] = [];
    const explicit = opts.extra?.[key];
    for (const t of explicit ?? list) {
      const p = got.get(t);
      if (!p?.text || !p.title) continue;
      if (found.some((f) => f.title === p.title)) continue;
      const own = catchRows(p.text).filter((r) => tpl.has(r.tpl));
      if (!own.length && subs.has(p.title)) {
        for (const st of subs.get(p.title)!) {
          const sp = subPages.get(st);
          if (!sp?.text || !sp.title || found.some((f) => f.title === sp.title)) continue;
          const rows = catchRows(sp.text).filter((r) => tpl.has(r.tpl));
          if (rows.length) found.push({ title: sp.title, url: pageUrl(sp.title), rows, boxes: specialBoxes(sp.text) });
        }
        if (found.length) break;
        continue;
      }
      const rows = own;
      if (!rows.length) continue;
      found.push({ title: p.title, url: pageUrl(p.title), rows, boxes: specialBoxes(p.text) });
      // The first page found by name; or every page an explicit list names.
      if (!explicit) break;
    }
    out.set(key, found);
  }
  return out;
}

/** Map a Bulbapedia row's method to a kind (undefined = wild). Scarlet/Violet's special-encounter table is all fixed encounters. */
export function bulbaKind(method: string, tpl?: string, div?: string): "gift" | "static" | "trade" | "egg" | "fossil" | "roaming" | undefined {
  if (tpl === "entry9/special") return "static";
  // The Legends games' tables have no method column: the divider says it ("Gift Pokémon", "Restored from a Fossil").
  if ((tpl === "entryla" || tpl === "entryza") && div) {
    if (/\bGift Pokémon\b/i.test(div)) return "gift";
    if (/\bFossil\b/i.test(div)) return "fossil";
    if (/\bTrade\b/i.test(div)) return "trade";
  }
  const m = method.trim();
  if (/^(Gift|Starter|Prize|Purchase|Buy)$/i.test(m)) return "gift";
  if (/^Egg$/i.test(m)) return "egg";
  if (/^Trade$/i.test(m)) return "trade";
  if (/^(Dome|Helix|Amber|Root|Claw|Skull|Armor|Cover|Plume|Jaw|Sail|Fossil|Revive)$/i.test(m)) return "fossil";
  if (/^(Special|Only one|Static|Interact)$/i.test(m)) return "static";
  if (/^Roaming$/i.test(m)) return "roaming";
  return undefined;
}

/** Bulbapedia's walking terrains (what PokéAPI's "walk" is in that place). */
export const TERRAIN: Record<string, string> = {
  grass: "Grass",
  "tall grass": "Tall grass",
  "long grass": "Long grass",
  cave: "Cave",
  building: "Walking",
  sand: "Deep sand",
  "rough terrain": "Rough terrain",
  "dark grass": "Dark grass",
  "dark tall grass": "Dark grass",
  snow: "Snow",
  puddle: "Puddle",
  water: "Surf",
};
