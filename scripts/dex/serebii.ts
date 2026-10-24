/**
 * Serebii parsers for the games PokéAPI has no (usable) encounter data for:
 * Let's Go, Sword/Shield (+ Isle of Armor / Crown Tundra), Brilliant Diamond /
 * Shining Pearl, Legends: Arceus, Scarlet/Violet (+ DLC) and Legends: Z-A.
 *
 * Serebii publishes two shapes:
 *  - detail tables (Location | Method | Weather/Time | Rarity | Level) for
 *    Let's Go, Sword/Shield and BD/SP;
 *  - an overview list of areas per game (wild / fixed / raid) for the rest,
 *    which carries no levels or rates.
 */
import type { RawRow } from "../../src/lib/pokemon/encounter-transform";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", Eacute: "É", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };
export const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m);
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "14 - 16" -> "14–16", "15 - 15" -> "15". */
function levels(s: string): string | undefined {
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return s.match(/\d+/) ? s.trim() : undefined;
  return m[1] === m[2] ? m[1] : `${m[1]}–${m[2]}`;
}
const rate = (s: string) => (/\d/.test(s) ? s.replace(/\s+/g, "") : undefined);
const baseOf = (loc: string) => loc.split(" - ")[0].trim();
const subOf = (loc: string) => loc.split(" - ").slice(1).join(" - ").trim() || undefined;
/** "Great Marsh - Area 2" -> place + sub-area. */
const place = (loc: string) => ({ loc: baseOf(loc), base: baseOf(loc), sub: subOf(loc) });

function tableAfter(html: string, anchor: string): string | undefined {
  const i = html.indexOf(`name="${anchor}"`);
  if (i < 0) return undefined;
  const end = html.indexOf("</table>", i);
  return html.slice(i, end < 0 ? undefined : end);
}
function cells(table: string): string[][] {
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((tr) => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])))
    .filter((r) => r.length >= 4 && r[0] !== "Location");
}

/* ------------------------------------------------------ detail tables -- */

const WEATHER_ALL = new Set(["all weather", "normal weather"]);

/** Sword/Shield detail section: Location | Method | Weather | Rarity | Level. */
export function parseSwshDetail(html: string, anchor: string, ver: string): RawRow[] {
  const t = tableAfter(html, anchor);
  if (!t) return [];
  const groups = new Map<string, RawRow & { weather: string[] }>();
  for (const [loc, method, weather, rarity, lvl] of cells(t)) {
    const m = method === "Random" ? "Grass (random)" : method;
    const key = [loc, m, rarity, lvl].join("|");
    const g = groups.get(key) ?? { ver, ...place(loc), m, lv: levels(lvl), r: rate(rarity), weather: [] };
    g.weather.push(weather);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ weather, ...row }) => {
    const uniq = [...new Set(weather)];
    if (uniq.length === 1 && WEATHER_ALL.has(uniq[0].toLowerCase())) return row;
    if (uniq.length >= 6) return { ...row, n: "All weather" };
    return { ...row, n: uniq.join(", ") };
  });
}

/** BD/SP detail section: Location | Method | Time | Rarity | Level. Time rows become Morning/Day/Night columns. */
export function parseBdspDetail(html: string, anchor: string, ver: string): RawRow[] {
  const t = tableAfter(html, anchor);
  if (!t) return [];
  const groups = new Map<string, { loc: string; m: string; lv?: string; slots: [string, string, string]; any?: string }>();
  for (const [loc, method, time, rarity, lvl] of cells(t)) {
    const m = method === "Random" ? "Grass" : method;
    const key = [loc, m, lvl].join("|");
    const g = groups.get(key) ?? { loc, m, lv: levels(lvl), slots: ["—", "—", "—"] as [string, string, string] };
    const r = rate(rarity) ?? "—";
    const slot = { morning: 0, day: 1, night: 2 }[time.toLowerCase() as "morning"];
    if (slot === undefined) g.any = r;
    else g.slots[slot] = r;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const row: RawRow = { ver, ...place(g.loc), m: g.m, lv: g.lv };
    if (g.any) row.r = g.any;
    else if (g.slots[0] === g.slots[1] && g.slots[1] === g.slots[2]) row.r = g.slots[0];
    else row.t = g.slots;
    return row;
  });
}

/** Let's Go detail section: Location | Method | Rarity | Level. */
export function parseLgpeDetail(html: string, anchor: string, ver: string): RawRow[] {
  const t = tableAfter(html, anchor);
  if (!t) return [];
  return cells(t).map(([loc, method, rarity, lvl]) => ({ ver, ...place(loc), m: method, lv: levels(lvl), r: rate(rarity) }));
}

/* ----------------------------------------------------------- overview -- */

const GAME_VERSIONS: Record<string, string> = {
  Sword: "sword",
  Shield: "shield",
  "Brilliant Diamond": "brilliant-diamond",
  "Shining Pearl": "shining-pearl",
  "Legends: Arceus": "legends-arceus",
  Scarlet: "scarlet",
  Violet: "violet",
  "Legends: Z-A": "legends-za",
  "Legends: Z-A Mega Dimension": "legends-za",
};
const BASE_DETAIL_GAMES = new Set(["sword", "shield", "brilliant-diamond", "shining-pearl"]);

/** Overview "Locations" table: areas per game, split by wild / fixed / raid. */
export function parseOverview(html: string, opts: { skipDetailedBase?: boolean } = {}): RawRow[] {
  const start = html.indexOf("<h2>Locations</h2>");
  if (start < 0) return [];
  const table = html.slice(start, html.indexOf("</table>", start));
  const out: RawRow[] = [];
  let dlc = "";
  let dlcLeft = 0;
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({ attrs: m[1], html: m[2], text: text(m[2]) }));
    const info = tds.find((d) => /fooinfo/.test(d.attrs));
    if (!info) continue;
    const labels = tds.filter((d) => d !== info && !/foodet/.test(d.attrs) && d.text);
    let game: string | undefined;
    let region = "";
    const span = labels.find((l) => /rowspan="(\d+)"/.test(l.attrs));
    if (span) {
      dlc = span.text;
      dlcLeft = Number(span.attrs.match(/rowspan="(\d+)"/)![1]);
      game = labels.find((l) => l !== span)?.text;
    } else {
      game = labels[0]?.text;
    }
    if (dlcLeft > 0) {
      region = dlc;
      dlcLeft--;
    }
    if (!game || !(game in GAME_VERSIONS)) continue;
    const ver = GAME_VERSIONS[game];
    if (opts.skipDetailedBase && !region && BASE_DETAIL_GAMES.has(ver)) continue;
    if (opts.skipDetailedBase && region && !/Isle of Armor|Crown Tundra/.test(region)) continue;
    const megaDim = game === "Legends: Z-A Mega Dimension";
    for (const seg of info.html.split(/<br\s*\/?>/i)) {
      const t = text(seg);
      if (!t) continue;
      const links = [...seg.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((l) => text(l[1])).filter(Boolean);
      const n = region || undefined;
      // Link-less text ("Starter Pokémon in Cabo Poco", "Event only"…) is shown as a note row.
      if (!links.length && !/Massive Mass Outbreak/i.test(t) && !/^(Fixed|Max Raid Battles|Tera Raid Battles):$/.test(t)) {
        out.push({ ver, x: n ? `${t} (${n})` : t });
        continue;
      }
      if (/Massive Mass Outbreak/i.test(t)) {
        out.push({ ver, loc: (links[0] ?? t).split(":")[0].trim(), base: undefined, m: "Massive mass outbreak", n });
        continue;
      }
      const prefix = t.match(/^(Fixed|Max Raid Battles|Tera Raid Battles):/)?.[1];
      let m = prefix === "Fixed" ? "Static" : prefix === "Max Raid Battles" ? "Max Raid" : prefix === "Tera Raid Battles" ? "Tera Raid" : "Wild";
      if (megaDim) m = "Hyperspace";
      // Legends: Arceus lists "<b>Area</b>: <a>Spot</a> or nearby".
      const bold = seg.match(/^\s*<a[^>]*><b>([\s\S]*?)<\/b><\/a>:/)?.[1];
      if (bold) {
        const spot = links.slice(1);
        for (const s of spot.length ? spot : [text(bold)]) out.push({ ver, loc: `${s} (${text(bold)})`, base: s, m, n: /or nearby/.test(t) ? "or nearby" : n });
        continue;
      }
      if (m === "Tera Raid" || m === "Max Raid") {
        for (const l of links) out.push({ ver, loc: l, base: m === "Max Raid" ? l : undefined, m, n });
        continue;
      }
      for (const l of links) out.push({ ver, loc: l, base: l, m, n });
    }
  }
  return out;
}
