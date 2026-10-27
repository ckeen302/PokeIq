/**
 * A small wikitext reader for Bulbapedia's trainer templates: it walks a page
 * in order, yielding headings and top-level templates ({{Party}},
 * {{Pokémon}}, {{Trainerentry}}, {{trainerdiv}} …) with their parameters
 * split the way MediaWiki splits them (pipes inside nested templates and
 * links don't count). Only facts (species, levels, moves, items, places) are
 * read; no prose is kept.
 */

export interface Tpl {
  kind: "tpl";
  /** Template name, first letter upper-cased, spaces normalised ("Trainerentry", "Party/end"). */
  name: string;
  /** Positional parameters (1-based in wiki terms; index 0 here is parameter 1). */
  pos: string[];
  /** Named parameters. Numeric names ("36") land here too when written as 36=…. */
  named: Record<string, string>;
  /** Offset in the page. */
  at: number;
  /** Offset just past the closing braces. */
  end: number;
}

export interface Heading {
  kind: "h";
  level: number;
  text: string;
  at: number;
}

export type WikiEvent = Tpl | Heading;

/** Index just past the `}}` closing the template that opens at `i` (text[i..i+1] === "{{"), or -1. */
function closeOf(text: string, i: number): number {
  let depth = 0;
  for (let j = i; j < text.length - 1; j++) {
    if (text.startsWith("<!--", j)) {
      const e = text.indexOf("-->", j + 4);
      if (e < 0) return -1;
      j = e + 2;
      continue;
    }
    if (text[j] === "{" && text[j + 1] === "{") {
      depth++;
      j++;
    } else if (text[j] === "}" && text[j + 1] === "}") {
      depth--;
      j++;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** Split a template body on top-level pipes. */
export function splitPipes(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let tpl = 0;
  let link = 0;
  for (let j = 0; j < body.length; j++) {
    const two = body.slice(j, j + 2);
    if (two === "{{") {
      tpl++;
      cur += two;
      j++;
    } else if (two === "}}" && tpl > 0) {
      tpl--;
      cur += two;
      j++;
    } else if (two === "[[") {
      link++;
      cur += two;
      j++;
    } else if (two === "]]" && link > 0) {
      link--;
      cur += two;
      j++;
    } else if (body[j] === "|" && tpl === 0 && link === 0) {
      out.push(cur);
      cur = "";
    } else cur += body[j];
  }
  out.push(cur);
  return out;
}

export function parseTemplate(src: string, at = 0): Tpl {
  const body = src.slice(2, -2);
  const parts = splitPipes(body);
  const rawName = parts.shift()!.trim().replace(/_/g, " ").replace(/\s+/g, " ");
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const pos: string[] = [];
  const named: Record<string, string> = {};
  for (const p of parts) {
    const m = /^\s*([A-Za-z0-9_\- ]+?)\s*=([\s\S]*)$/.exec(p);
    if (m) named[m[1].trim()] = m[2].trim();
    else pos.push(p.trim());
  }
  return { kind: "tpl", name, pos, named, at, end: at + src.length };
}

/** Headings and top-level templates of a page, in order (comments skipped). */
export function pageEvents(text: string): WikiEvent[] {
  const out: WikiEvent[] = [];
  let i = 0;
  let lineStart = true;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const e = text.indexOf("-->", i + 4);
      i = e < 0 ? text.length : e + 3;
      continue;
    }
    if (lineStart && text[i] === "=") {
      const nl = text.indexOf("\n", i);
      const line = text.slice(i, nl < 0 ? text.length : nl).trim();
      const m = /^(={1,6})\s*(.*?)\s*\1$/.exec(line);
      if (m) {
        out.push({ kind: "h", level: m[1].length, text: plain(m[2]), at: i });
        i = nl < 0 ? text.length : nl + 1;
        lineStart = true;
        continue;
      }
    }
    if (text[i] === "{" && text[i + 1] === "{") {
      const e = closeOf(text, i);
      if (e > 0) {
        out.push(parseTemplate(text.slice(i, e), i));
        i = e;
        lineStart = false;
        continue;
      }
    }
    lineStart = text[i] === "\n";
    i++;
  }
  return out;
}

/** Inline templates whose display is one of their parameters. */
const SHOW_ARG: Record<string, number> = { colorlink: 1, Colorlink: 1, color2: 2, color: 2, tt: 1, sup: 2, "sup/3": 2, "sup/4": 2, "sup/5": 2, "sup/6": 2, "sup/7": 2, "sup/8": 2, "sup/9": 2, m: 1, i: 1, p: 1, a: 1, t: 1, tc: 1, ga: 1, g: 1, game: 1, "game2": 1, pkmn: 1, "pkmn2": 1, rt: 1, pdollar: 1, PDollar: 1, Pdollar: 1, wp: 2, ka: 1, an: 1, DL: 2, cat: 1, OBP: 1, smallcaps: 1, nowrap: 1, aniseries: 1, MangaArc: 1, badge: 1, player: 1 };
/** Game-abbreviation templates used in headings ("{{B2W2}}"). */
const GAME_ABBR: Record<string, string> = {
  RBY: "Red, Blue, and Yellow",
  RGBY: "Red, Green, Blue, and Yellow",
  GSC: "Gold, Silver, and Crystal",
  RSE: "Ruby, Sapphire, and Emerald",
  FRLG: "FireRed and LeafGreen",
  DP: "Diamond and Pearl",
  DPPt: "Diamond, Pearl, and Platinum",
  Pt: "Platinum",
  HGSS: "HeartGold and SoulSilver",
  BW: "Black and White",
  B2W2: "Black 2 and White 2",
  BW2: "Black 2 and White 2",
  XY: "X and Y",
  ORAS: "Omega Ruby and Alpha Sapphire",
  SM: "Sun and Moon",
  USUM: "Ultra Sun and Ultra Moon",
  PE: "Let's Go, Pikachu! and Let's Go, Eevee!",
  LGPE: "Let's Go, Pikachu! and Let's Go, Eevee!",
  SwSh: "Sword and Shield",
  BDSP: "Brilliant Diamond and Shining Pearl",
  SV: "Scarlet and Violet",
  LA: "Legends: Arceus",
  ZA: "Legends: Z-A",
};

const FIXED: Record<string, string> = {
  ...GAME_ABBR, PK: "Pokémon", MN: "", "!": "|", "-": "", pkmn: "Pokémon", Pkmn: "Pokémon", player: "Player", Player: "Player", tera: "Tera", Tera: "Tera", dl: "", TRT: "Team Rocket trio", Ash: "Ash", Pdollar: "₽", PDollar: "₽", pdollar: "₽" };

/** Wikitext to plain text: templates resolved to their visible argument, links to their label, markup dropped. */
export function plain(s: string): string {
  let out = s;
  for (let guard = 0; guard < 8 && /\{\{|\[\[/.test(out); guard++) {
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => {
      const parts = inner.split("|");
      const name = parts[0].trim();
      if (name in FIXED && parts.length === 1) return FIXED[name];
      const k = SHOW_ARG[name] ?? SHOW_ARG[name.charAt(0).toLowerCase() + name.slice(1)];
      if (k !== undefined) {
        const args = parts.slice(1).filter((x) => !/^\s*[a-z0-9]+\s*=/.test(x));
        if (name === "game" || name === "Game") return args[0] ? (/^(s|2)$/.test(args[1] ?? "") ? `${args[0]}` : args[0]) : "";
        if (name === "badge") return `${args[0] ?? ""} Badge`;
        // {{color2|hex|link|label}} shows the label (or the link when there is none).
        if (/^colou?r2?$/i.test(name)) return (args.length > 1 ? args[args.length - 1] : "").trim();
        if (/^sup\//.test(name) || name === "sup") return "";
        if (name === "player") return "Player";
        return (args[k - 1] ?? args[0] ?? "").trim();
      }
      if (/^(PDollar|pdollar|Pdollar)$/.test(name)) return "₽";
      return parts.length > 1 ? parts[parts.length - 1] : "";
    });
    out = out.replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1");
  }
  return out
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(small|sup|sub|span|b|i|s|u|big|div)[^>]*>/gi, "")
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "{{tt|21|19 in Easy Mode, 23 in Challenge Mode}}" -> "21"; plain values pass through. */
export function firstValue(s: string | undefined): string {
  if (!s) return "";
  // B2W2 Gyms: "{{tt|10|Easy Mode}}/{{tt|11|Normal Mode}}" -> the Normal Mode value.
  const normal = /\{\{\s*tt\s*\|([^|}]*)\|\s*Normal Mode\s*\}\}/i.exec(s);
  if (normal) return normal[1].trim();
  const tt =/^\s*\{\{\s*tt\s*\|([^|}]*)/i.exec(s);
  if (tt) return tt[1].trim();
  return plain(s);
}
