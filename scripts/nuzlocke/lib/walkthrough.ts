/**
 * Bulbapedia's walkthroughs ("Walkthrough:Pokémon FireRed and LeafGreen" and its "/Part N" pages): the places the
 * story visits, in order, and the trainer battles on the way ({{Party}} blocks with their {{Pokémon}} levels).
 */
import { catchRows, type BulbaRow } from "./bulba-catch";
import { pages, pageUrl, plain, templates, type Template } from "./bulbapedia";

export interface WtHeading {
  type: "head";
  /** Heading level (2 for ==X==). */
  lvl: number;
  name: string;
  /** Pages the heading links to ("Entering [[East Province (Area Three)]]"). */
  linked: string[];
  /** Parent headings, outermost first. */
  path: string[];
  part: number;
  at: number;
}

export interface WtMon {
  species: number;
  name: string;
  level: number;
}

export interface WtParty {
  type: "party";
  cls: string;
  name: string;
  /** The Party's `game` code (FRLG, B, W, SwSh…). */
  game: string;
  /** The Party's caption (e.g. the player's starter choice), plain text. */
  caption: string;
  sprite: string;
  /** The enclosing {{WalkthroughGym}}'s badge and name, when inside one. */
  gym?: { badge: string; name: string };
  /** The heading chain above the party. */
  path: string[];
  mons: WtMon[];
  part: number;
  at: number;
  /** Raw named params of the Party template. */
  named: Record<string, string>;
  /**
   * Not a {{Party}}: a lone {{Pokémon|walkthrough=yes}} (a wild boss such as a Titan, its name and level), or a level
   * the walkthrough states in its text ("The Titan Orthworm is level 29").
   */
  standalone?: boolean;
}

export type WtEvent = WtHeading | WtParty;

export interface Walkthrough {
  title: string;
  url: string;
  /** In the index's order; `idx` (1-based) is what events' `part` refers to (DLC sections restart their "Part N"). */
  parts: { idx: number; n: number; title: string; url: string; summary: string; postGame: boolean }[];
  events: WtEvent[];
  /** Link label/target (plain) -> page title, from every [[link]] and {{rt}} in the walkthrough. */
  links: Map<string, string>;
  /** The walkthrough's own "Available Pokémon" tables ({{Catch/entry…}} rows, with their headings). */
  catches: { part: number; row: BulbaRow }[];
}

const REGION_RT: Record<string, string> = { kanto: "Kanto", johto: "Johto", hoenn: "Hoenn", sinnoh: "Sinnoh", unova: "Unova", kalos: "Kalos", alola: "Alola", galar: "Galar" };

export async function walkthrough(title: string): Promise<Walkthrough> {
  const idx = (await pages([title])).get(title)!;
  if (!idx.text) throw new Error(`no walkthrough page ${title}`);
  // Parts in the index's order; "Post-Game" (or similar) header rows mark the rest as post-game.
  const parts: Walkthrough["parts"] = [];
  let post = false;
  for (const line of idx.text.split("\n")) {
    if (/^!\s*colspan.*\|\s*(Post-?game|Post-?Game|After the Hall of Fame|Postgame)/i.test(line)) post = true;
    const m = line.match(/\[\[(Walkthrough:[^|\]]+\/Part (\d+))\|/);
    if (m && !parts.some((p) => p.title === m[1])) parts.push({ idx: parts.length + 1, n: Number(m[2]), title: m[1], url: pageUrl(m[1]), summary: "", postGame: post });
    else if (parts.length && /^\|\s*style=.*\|\s*''/.test(line) && !parts[parts.length - 1].summary) parts[parts.length - 1].summary = plain(line.replace(/^\|[^|]*\|/, ""));
  }
  // The index may lay out a DLC's parts beside the main story's (Sword/Shield): the main story comes first, by part
  // number, then each DLC's parts in the order the index first names that DLC.
  const dlcOf = (t: string) => (t.match(/^Walkthrough:Pokémon [^/]+\/Part \d+$/) ? "" : t.replace(/\/Part \d+$/, ""));
  const dlcOrder = [...new Set(parts.map((p) => dlcOf(p.title)))];
  parts.sort((a, b) => dlcOrder.indexOf(dlcOf(a.title)) - dlcOrder.indexOf(dlcOf(b.title)) || a.n - b.n);
  parts.forEach((p, i) => (p.idx = i + 1));
  const got = await pages(parts.map((p) => p.title));
  const events: WtEvent[] = [];
  const links = new Map<string, string>();
  const catches: Walkthrough["catches"] = [];
  for (const p of parts) {
    const text = got.get(p.title)?.text;
    if (!text) continue;
    for (const l of text.matchAll(/\[\[([^|\]#:]+)(?:#[^|\]]*)?(?:\|([^\]]*))?\]\]/g)) {
      const target = l[1].trim();
      for (const label of [target, l[2]].filter(Boolean) as string[]) {
        const k = plain(label);
        if (k && !links.has(k)) links.set(k, target);
      }
    }
    for (const r of text.matchAll(/\{\{rt\|(\d+)\|(\w+)[^}]*\}\}/gi)) {
      const reg = REGION_RT[r[2].toLowerCase()] ?? r[2];
      const k = `${reg} Route ${r[1]}`;
      if (!links.has(k)) links.set(k, `${reg} Route ${r[1]}`);
    }
    for (const row of catchRows(text, { whole: true })) catches.push({ part: p.idx, row });
    const heads = [...text.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)].map((h) => ({ lvl: h[1].length, raw: h[2], at: h.index! }));
    const chain: { lvl: number; name: string }[] = [];
    const pathAt: { at: number; path: string[] }[] = [];
    for (const h of heads) {
      const name = plain(h.raw);
      while (chain.length && chain[chain.length - 1].lvl >= h.lvl) chain.pop();
      const path = chain.map((c) => c.name);
      chain.push({ lvl: h.lvl, name });
      const linked = [...h.raw.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]*))?\]\]/g)].map((x) => plain(x[2] ?? x[1]));
      events.push({ type: "head", lvl: h.lvl, name, linked, path, part: p.idx, at: h.at });
      pathAt.push({ at: h.at, path: [...path, name] });
    }
    const all = templates(text);
    const gyms = all.filter((t) => /^WalkthroughGym$/i.test(t.name));
    const spans: [number, number][] = [];
    for (const t of all) {
      if (!/^Party$/i.test(t.name)) continue;
      const end = text.indexOf("{{Party/end}}", t.end);
      spans.push([t.start, end < 0 ? text.length : end]);
      const inner = templates(text.slice(t.end, end < 0 ? undefined : end)).filter((x) => /^Pokémon$/i.test(x.name));
      const mons = inner.map(monOf).filter((m): m is WtMon => !!m);
      const gym = gyms.find((g) => g.start < t.start && g.end > t.end);
      const where = pathAt.filter((x) => x.at < t.start).pop();
      events.push({
        type: "party",
        cls: plain(t.named.class ?? ""),
        name: plain(t.named.name ?? "").replace(/\s*\(game\)$/, ""),
        game: plain(t.named.game ?? ""),
        caption: plain(t.named.caption ?? ""),
        sprite: plain(t.named.sprite ?? ""),
        ...(gym ? { gym: { badge: plain(gym.named.badge ?? ""), name: plain(gym.named.name ?? "") } } : {}),
        path: where?.path ?? [],
        mons,
        part: p.idx,
        at: t.start,
        named: t.named,
      });
    }
    const lone = (at: number, mon: WtMon): WtParty => ({ type: "party", cls: "", name: mon.name, game: "", caption: "", sprite: "", path: pathAt.filter((x) => x.at < at).pop()?.path ?? [], mons: [mon], part: p.idx, at, named: {}, standalone: true });
    for (const t of all) {
      if (!/^Pokémon$/i.test(t.name) || plain(t.named.walkthrough ?? "") !== "yes" || spans.some(([a, b]) => t.start > a && t.start < b)) continue;
      const mon = monOf(t);
      if (mon) events.push(lone(t.start, mon));
    }
    for (const m of text.matchAll(/\bThe Titan ([A-Z][a-z]+) is level (\d+)\b/g)) events.push(lone(m.index!, { species: 0, name: m[1], level: Number(m[2]) }));
  }
  events.sort((a, b) => a.part - b.part || a.at - b.at);
  return { title, url: pageUrl(title), parts, events, links, catches };
}

function monOf(t: Template): WtMon | null {
  const lv = plain(t.named.level ?? "").match(/\d+/);
  if (!lv) return null;
  return { species: Number(plain(t.named.ndex ?? "").match(/\d+/)?.[0] ?? 0), name: plain(t.named.pokemon ?? ""), level: Number(lv[0]) };
}
