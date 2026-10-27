/**
 * Build src/data/trainers/<game>.json for the Generation V–IX games from
 * Bulbapedia's location pages (there are no complete decompilations of these
 * games to read instead).
 *
 *   npx tsx scripts/trainers/wiki-import.ts [game…]          # all wiki games, or the ones named
 *   WIKI_DEBUG=1 npx tsx scripts/trainers/wiki-import.ts sv  # log requests
 *
 * How it works
 *  1. Every page in each region's "<Region> locations" category tree (gyms,
 *     DLC areas and sub-locations included) is fetched once through the
 *     MediaWiki API and cached under .data/wiki/ (gitignored).
 *  2. Each page is walked in order. Trainer data lives in two template
 *     families: {{Party}} … {{Pokémon}} … {{Party/end}} (full sets: level,
 *     held item, ability, moves, Tera Type) and {{Trainerentry}} rows
 *     (species, level and held item only). Section headings say which game a
 *     block belongs to; a {{Party}}'s own `game` code wins over them.
 *     {{trainerdiv}} labels give version splits ("Black 2"), rematches and
 *     sub-areas.
 *  3. Rows that list no moves get, for Black/White and Black 2/White 2 only,
 *     the level-up default moveset those games build (the last four level-up
 *     moves at or below the level), from PokeAPI's per-version-group
 *     learnsets (.data/pokeapi/pokemon_moves.csv, from
 *     github.com/PokeAPI/pokeapi data/v2/csv). The Serebii cross-check agrees
 *     with ~95% of those teams (the rest are trainers with hidden custom sets,
 *     mostly Veterans). For Gen VI–IX the wiki's rows omit moves the games do
 *     set explicitly (Serebii shows 2–3-move custom sets for many Gen VII
 *     trainers), so those rows keep no moves rather than a guess.
 *  4. The same battle listed on two pages (a Gym page and its city page) is
 *     merged. Every species, move and item is resolved against our Pokédex;
 *     anything unknown is reported and the import fails.
 *
 * Only facts are read (species, levels, moves, items, places); no wiki prose
 * is copied.
 */
import fs from "node:fs";
import path from "node:path";
import { TRAINER_GAMES } from "../../src/lib/trainers/games";
import { notableFor } from "../../src/lib/trainers/notable";
import type { TrainerMon } from "../../src/lib/trainers/types";
import pokedex from "../../src/data/pokedex.json";
import movesData from "../../src/data/moves.json";
import { assemble, type RawPlace, type RawTeam } from "./model";
import { itemRef, moveSlug, norm, speciesId, defaultMoves, type Learnset } from "./common";
import { categoryMembers, categoryTree, wikitextMany } from "./wiki-fetch";
import { firstValue, pageEvents, plain, type Tpl, type WikiEvent } from "./wiki-parse";

// ---------------------------------------------------------------------------
// Games

interface WikiGame {
  key: string;
  /** Bulbapedia's per-game location category (tells which game an unheaded page belongs to). */
  gameCat: string;
  gen: number;
  /** PokeAPI version group for level-up default movesets (Gen V–VII only). */
  vg?: number;
  /** Region category on Bulbapedia -> our region name. */
  cats: [string, string][];
  /** {{Party}} `game` codes -> versions (empty = every version of the file). */
  codes: Record<string, string[]>;
  versions: string[];
}

export const WIKI_GAMES: WikiGame[] = [
  { key: "black-white", gameCat: "Black and White locations", gen: 5, vg: 11, cats: [["Unova locations", "Unova"]], codes: { BW: [], BWB2W2: [], Bl: ["black"], B: ["black"], W: ["white"] }, versions: ["black", "white"] },
  { key: "black-2-white-2", gameCat: "Black 2 and White 2 locations", gen: 5, vg: 14, cats: [["Unova locations", "Unova"]], codes: { B2W2: [], BWB2W2: [], B2: ["black-2"], W2: ["white-2"], "Black 2 and White 2": [] }, versions: ["black-2", "white-2"] },
  { key: "x-y", gameCat: "X and Y locations", gen: 6, cats: [["Kalos locations", "Kalos"]], codes: { XY: [], XYORAS: [], X: ["x"], Y: ["y"] }, versions: ["x", "y"] },
  { key: "omega-ruby-alpha-sapphire", gameCat: "Omega Ruby and Alpha Sapphire locations", gen: 6, cats: [["Hoenn locations", "Hoenn"]], codes: { ORAS: [], XYORAS: [], OR: ["omega-ruby"], AS: ["alpha-sapphire"] }, versions: ["omega-ruby", "alpha-sapphire"] },
  { key: "sun-moon", gameCat: "Sun and Moon locations", gen: 7, cats: [["Alola locations", "Alola"]], codes: { SM: [], SMUSUM: [], Su: ["sun"], S: ["sun"], M: ["moon"], Mo: ["moon"] }, versions: ["sun", "moon"] },
  { key: "ultra-sun-ultra-moon", gameCat: "Ultra Sun and Ultra Moon locations", gen: 7, cats: [["Alola locations", "Alola"]], codes: { USUM: [], SMUSUM: [], US: ["ultra-sun"], UM: ["ultra-moon"] }, versions: ["ultra-sun", "ultra-moon"] },
  { key: "lets-go-pikachu-eevee", gameCat: "Let's Go, Pikachu! and Let's Go, Eevee! locations", gen: 7, cats: [["Kanto locations", "Kanto"]], codes: { PE: [], LGPE: [], LGP: ["lets-go-pikachu"], LGE: ["lets-go-eevee"] }, versions: ["lets-go-pikachu", "lets-go-eevee"] },
  {
    key: "sword-shield",
    gameCat: "Sword and Shield locations",
    gen: 8,
    cats: [
      ["Isle of Armor", "Isle of Armor"],
      ["Crown Tundra", "Crown Tundra"],
      ["Galar locations", "Galar"],
    ],
    codes: { SwSh: [], Sw: ["sword"], Sh: ["shield"] },
    versions: ["sword", "shield"],
  },
  { key: "brilliant-diamond-shining-pearl", gameCat: "Brilliant Diamond and Shining Pearl locations", gen: 8, cats: [["Sinnoh locations", "Sinnoh"]], codes: { BDSP: [], BD: ["brilliant-diamond"], SP: ["shining-pearl"] }, versions: ["brilliant-diamond", "shining-pearl"] },
  {
    key: "scarlet-violet",
    gameCat: "Scarlet and Violet locations",
    gen: 9,
    cats: [
      ["Kitakami locations", "Kitakami"],
      ["Blueberry Academy locations", "Blueberry Academy"],
      ["Paldea locations", "Paldea"],
    ],
    codes: { SV: [], Sc: ["scarlet"], V: ["violet"] },
    versions: ["scarlet", "violet"],
  },
];
const GAME = new Map(WIKI_GAMES.map((g) => [g.key, g]));
/** Pages with battles that the location categories don't list (filed under the parent page's area). */
const EXTRA_PAGES: Record<string, [string, string][]> = {
  "sun-moon": [["Pokémon League (Alola)/Title Defense", "Alola"]],
  "ultra-sun-ultra-moon": [["Pokémon League (Alola)/Title Defense", "Alola"]],
};
/** Regions whose location pages also describe Gen I–IV games. */
const OLD_REGIONS = new Set(["Kanto", "Hoenn", "Sinnoh"]);

/** Facility pages whose opponents are drawn at random (not fixed trainers). */
const SKIP_PAGE = /^(Battle (Subway|Maison|Tree|Tower|Chateau|Royal Dome|Agency|Hall|Frontier|Tent|Castle|Arcade|Factory|Palace|Pike|Pyramid|Dome|Institute|Company|Café|Zone)|Pokémon World Tournament|Join Avenue|Wild Area News|Pokémon Den|Max Lair|Battle Stadium|Pokémon Stadium|Global Link|Festival Plaza|Restricted Sparring|Ten Sights of Paldea|Titan Pokémon|Team Star)\b/;
/** Sections that aren't the core games (anime, manga, spin-offs…). */
const SKIP_HEAD = /anime|animation|manga|spin-off|side series|Masters|TCG|Trading Card|Stadium|Ranger|Mystery Dungeon|Pokémon GO|Trivia|Horizons|Battle Revolution|Colosseum|\bXD\b|Related articles|In other languages|Name origin|Japanese versions|Korean|Chinese|Special Demo|Legends|Z-A|Café Mix|Sleep|Unite|Conquest|Rumble|Pinball|Snap|Picross|Shuffle|Battle Trozei|Dream Radar|\bpartners?\b/i;

interface HeadInfo {
  /** Game keys (wiki games) or "old" for Gen I–IV / other games; null when the heading names no game. */
  games: string[] | null;
  ver?: string;
}

/** What game (and version) a section heading or caption names. */
export function headInfo(text: string): HeadInfo {
  const t = text.replace(/^Pokémon /, "").trim();
  const R: [RegExp, string[], string?][] = [
    [/Ultra Sun and (Pokémon )?Ultra Moon|\bUSUM\b/, ["ultra-sun-ultra-moon"]],
    [/^Ultra Sun$/, ["ultra-sun-ultra-moon"], "ultra-sun"],
    [/^Ultra Moon$/, ["ultra-sun-ultra-moon"], "ultra-moon"],
    [/Sun and (Pokémon )?Moon/, ["sun-moon"]],
    [/^Sun$/, ["sun-moon"], "sun"],
    [/^Moon$/, ["sun-moon"], "moon"],
    [/Black 2 and (Pokémon )?White 2|\bB2W2\b/, ["black-2-white-2"]],
    [/^Black 2$/, ["black-2-white-2"], "black-2"],
    [/^White 2$/, ["black-2-white-2"], "white-2"],
    [/Black and (Pokémon )?White(?! 2)/, ["black-white"]],
    [/^Black$/, ["black-white"], "black"],
    [/^White$/, ["black-white"], "white"],
    [/^X and (Pokémon )?Y$/, ["x-y"]],
    [/^X$/, ["x-y"], "x"],
    [/^Y$/, ["x-y"], "y"],
    [/Omega Ruby and (Pokémon )?Alpha Sapphire|\bORAS\b/, ["omega-ruby-alpha-sapphire"]],
    [/^Omega Ruby$/, ["omega-ruby-alpha-sapphire"], "omega-ruby"],
    [/^Alpha Sapphire$/, ["omega-ruby-alpha-sapphire"], "alpha-sapphire"],
    [/Let's Go,? Pikachu!? and (Pokémon )?Let's Go,? Eevee|Let's Go/, ["lets-go-pikachu-eevee"]],
    [/^Let's Go,? Pikachu!?$/, ["lets-go-pikachu-eevee"], "lets-go-pikachu"],
    [/^Let's Go,? Eevee!?$/, ["lets-go-pikachu-eevee"], "lets-go-eevee"],
    [/Sword and (Pokémon )?Shield|Isle of Armor|Crown Tundra/, ["sword-shield"]],
    [/^Sword$/, ["sword-shield"], "sword"],
    [/^Shield$/, ["sword-shield"], "shield"],
    [/Brilliant Diamond and (Pokémon )?Shining Pearl|\bBDSP\b/, ["brilliant-diamond-shining-pearl"]],
    [/^Brilliant Diamond$/, ["brilliant-diamond-shining-pearl"], "brilliant-diamond"],
    [/^Shining Pearl$/, ["brilliant-diamond-shining-pearl"], "shining-pearl"],
    [/Scarlet and (Pokémon )?Violet|Teal Mask|Indigo Disk/, ["scarlet-violet"]],
    [/^Scarlet$/, ["scarlet-violet"], "scarlet"],
    [/^Violet$/, ["scarlet-violet"], "violet"],
    [/^Generation V$/, ["black-white", "black-2-white-2"]],
    [/^Generation VI$/, ["x-y", "omega-ruby-alpha-sapphire"]],
    [/^Generation VII$/, ["sun-moon", "ultra-sun-ultra-moon", "lets-go-pikachu-eevee"]],
    [/^Generation VIII$/, ["sword-shield", "brilliant-diamond-shining-pearl"]],
    [/^Generation IX$/, ["scarlet-violet"]],
    [/^Generation (I|II|III|IV)$|\b(Red|Blue|Green|Yellow|Gold|Silver|Crystal|Ruby|Sapphire|Emerald|FireRed|LeafGreen|Diamond|Pearl|Platinum|HeartGold|SoulSilver|Legends|Z-A)\b/, ["old"]],
  ];
  for (const [re, games, ver] of R) if (re.test(t)) return { games, ver };
  return { games: null };
}

/** Heading words that only structure the page. */
const STRUCTURAL = /^(Trainers|In the games|In the core series games|In the core series|Additional Trainers|International versions|Trainer list|Gym Leaders and Elite Four|Battles|Opponents|Gym Trainers|All versions|Default|Easy Mode\/Normal Mode|Normal Mode|Story|Main story|Gym battle|Gym Leader battle|Gym Challenge|Structure|Places of interest)$/i;
/** Headings and div labels that describe when a battle happens rather than where. */
const WHEN = /^(Post|Pre|After|Before|During|Once|Upon|Initial battle|First visit|Second visit|First battle|Second battle|Third battle|Final battle|Rematch|Delta Episode|Episode RR|Requires|Accessed|Accessible|Only|If |When|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Weekdays|Weekends|Non-winter|Winter|Spring|Summer|Autumn|Day|Night|Morning|Evening)/i;

// ---------------------------------------------------------------------------
// Pokédex lookups

const SPECIES_NAME = new Map<number, string>((pokedex as { id: number; name: string }[]).map((p) => [p.id, p.name]));
const MOVE_SLUG_BY_ID = new Map<number, string>();
{
  const used = new Set<string>();
  for (const [id, m] of Object.entries(movesData as Record<string, { name: string }>).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    let slug = m.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (used.has(slug)) slug = `${slug}-${id}`;
    used.add(slug);
    MOVE_SLUG_BY_ID.set(Number(id), slug);
  }
}
/** Gen V–VII spellings the wiki keeps that our move list writes differently. */
const WIKI_MOVE_ALIAS: Record<string, string> = { hijumpkick: "highjumpkick", faintattack: "feintattack", vicegrip: "visegrip", smellingsalt: "smellingsalts", ancientpower: "ancientpower" };
const problems: string[] = [];
function wikiMove(name: string, where: string): string | undefined {
  const n = plain(name);
  if (!n || /^(None|—|-|\?+)$/.test(n)) return undefined;
  try {
    return moveSlug(WIKI_MOVE_ALIAS[norm(n)] ?? n);
  } catch {
    problems.push(`move "${n}" (${where})`);
    return undefined;
  }
}
function wikiSpecies(dex: string, name: string, where: string): number | undefined {
  const num = Number(/^\s*0*(\d+)/.exec(dex)?.[1] ?? NaN);
  const nm = plain(name);
  if (num && SPECIES_NAME.has(num)) {
    if (!nm || norm(SPECIES_NAME.get(num)!) === norm(nm) || norm(nm).startsWith(norm(SPECIES_NAME.get(num)!))) return num;
  }
  try {
    return speciesId(nm);
  } catch {
    problems.push(`species "${nm}" #${dex} (${where})`);
    return undefined;
  }
}
function wikiItem(name: string | undefined): string | undefined {
  const n = plain(name ?? "");
  if (!n || /^(None|No|—|-|N\/A|\?+)$/i.test(n)) return undefined;
  return itemRef(n.replace(/\s+/g, "_").toUpperCase(), n);
}

// PokeAPI level-up learnsets for the default movesets.
let LEARN: Map<string, Learnset> | null = null;
const POKEAPI = path.join(process.cwd(), ".data/pokeapi");
function learnset(vg: number, species: number, form?: string): Learnset {
  if (!LEARN) {
    LEARN = new Map();
    const formIds = new Map<string, number>();
    for (const line of fs.readFileSync(path.join(POKEAPI, "pokemon.csv"), "utf8").split("\n").slice(1)) {
      const [id, ident, sp] = line.split(",");
      if (id) formIds.set(ident, Number(id));
      void sp;
    }
    (LEARN as Map<string, Learnset> & { forms?: Map<string, number> }).forms = formIds;
    const rows: [number, number, number, number, number][] = [];
    for (const line of fs.readFileSync(path.join(POKEAPI, "pokemon_moves.csv"), "utf8").split("\n").slice(1)) {
      const [pid, g, mid, method, lvl, order] = line.split(",");
      if (method !== "1") continue;
      rows.push([Number(pid), Number(g), Number(mid), Number(lvl), Number(order || 0)]);
    }
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3] || a[4] - b[4]);
    for (const [pid, g, mid, lvl] of rows) {
      const k = `${g}:${pid}`;
      const slug = MOVE_SLUG_BY_ID.get(mid);
      if (!slug) continue;
      if (!LEARN.has(k)) LEARN.set(k, []);
      LEARN.get(k)!.push({ level: lvl, move: slug });
    }
  }
  let pid = species;
  const forms = (LEARN as Map<string, Learnset> & { forms?: Map<string, number> }).forms!;
  const base = norm(SPECIES_NAME.get(species) ?? "");
  if (form && /Alola/i.test(form)) pid = forms.get(`${base}-alola`) ?? pid;
  if (form && /Galar/i.test(form)) pid = forms.get(`${base}-galar`) ?? pid;
  return LEARN.get(`${vg}:${pid}`) ?? [];
}

// ---------------------------------------------------------------------------
// Page walking

interface WikiMon extends TrainerMon {
  /** Version-only member of a team (a {{Pokémon}} captioned "Scarlet"). */
  onlyVer?: string;
}

interface Found {
  page: string;
  /** Candidate wiki games from headings / codes (null: anything that fits the region). */
  games: string[] | null;
  /** The games came from a {{Party}} `game` code. */
  fromCode?: boolean;
  /** Sprite file name (its game tag breaks ties: "Spr B2W2 Scientist M.png"). */
  sprite?: string;
  gen?: number;
  ver?: string;
  cls: string;
  name?: string;
  tag?: string;
  section?: string;
  double?: boolean;
  custom: boolean;
  team: WikiMon[];
}

const PAIR_CLASS = /Twins|Duo|Couple|Hooligans|Sis and Bro|Sis & Bro|Sr\. and Jr\.|Mother & Child|Colleagues|Interviewers|Teammates|Sisters|Brothers|Belle & Pa|Rich Couple|Family|& /;

function playerChoice(s: string): string | undefined {
  const m = /\{\{\s*PlayerChoice\s*\|\s*([^|}]*)(?:\|\s*([^|}]*))?/i.exec(s);
  if (!m) return undefined;
  if (/^LGP$/i.test(m[1])) return "Let's Go, Pikachu!";
  if (/^LGE$/i.test(m[1])) return "Let's Go, Eevee!";
  return m[2] ? `If you chose ${plain(m[2])}` : undefined;
}

/** Games a sprite file name is tagged with ("Spr B2W2 Scientist M.png", "VSYoungster SwSh.png"). */
function spriteGames(sprite: string): string[] {
  const s = ` ${sprite.replace(/[_.]/g, " ")} `;
  const out: string[] = [];
  if (/ B2W2 /.test(s)) out.push("black-2-white-2");
  else if (/ BW /.test(s)) out.push("black-white");
  if (/ USUM /.test(s)) out.push("ultra-sun-ultra-moon");
  else if (/ SM /.test(s)) out.push("sun-moon");
  if (/ XY /.test(s)) out.push("x-y");
  if (/ ORAS /.test(s)) out.push("omega-ruby-alpha-sapphire");
  return out;
}

/** Drop the wiki's disambiguators ("Calem (game)", "Honey (character)"). */
const cleanName = (s: string) => s.replace(/\s*\((game|character|Trainer class|anime|manga)\)$/i, "").trim();

function divLabel(t: Tpl): string | undefined {
  const l = t.pos[1] ? plain(t.pos[1]) : "";
  return l || undefined;
}

/** Trainers on one page. */
export function pageTrainers(title: string, text: string): Found[] {
  const ev: WikiEvent[] = pageEvents(text);
  const out: Found[] = [];
  const stack: { level: number; text: string; info: HeadInfo }[] = [];
  let skipBelow = 0;
  let div: { ver?: string; tag?: string; section?: string } = {};
  let party: Found[] | null = null;
  let partyIdx = 0;
  let partyCounts: number[] = [];

  const ctx = () => {
    let games: string[] | null = null;
    let ver: string | undefined;
    let tag: string | undefined;
    let section: string | undefined;
    for (const h of stack) {
      if (h.info.games) {
        games = h.info.games;
        if (h.info.ver) ver = h.info.ver;
        section = undefined;
        tag = undefined;
      } else if (STRUCTURAL.test(h.text)) continue;
      else if (WHEN.test(h.text)) tag = h.text;
      else section = section ? `${section} · ${h.text}` : h.text;
    }
    return { games, ver, tag, section };
  };

  const closeParty = () => {
    if (party) for (const p of party) if (p.team.length) out.push(p);
    party = null;
  };

  let prevEnd = 0;
  for (const e of ev) {
    const myEnd = e.kind === "tpl" ? e.end : e.at;
    // Inline templates inside prose ({{p|Kecleon}}) don't end the prose gap.
    const isBlock = e.kind === "h" || /^(Party|Pokémon|Trainer|trainer)/i.test(e.name);
    try {
      walk(e);
    } finally {
      if (isBlock) prevEnd = myEnd;
    }
  }
  closeParty();
  return out;

  function walk(e: WikiEvent): void {
    if (e.kind === "h") {
      closeParty();
      div = {};
      if (skipBelow && e.level > skipBelow) return;
      skipBelow = 0;
      while (stack.length && stack[stack.length - 1].level >= e.level) stack.pop();
      // B2W2 Gyms list the Easy and Challenge Mode parties too: keep only Normal Mode.
      if ((SKIP_HEAD.test(e.text) && !/^(Pokémon )?(Sun|Moon|Ultra)/.test(e.text)) || /^(Challenge|Easy) Mode$/i.test(e.text)) {
        skipBelow = e.level;
        return;
      }
      stack.push({ level: e.level, text: e.text, info: headInfo(e.text) });
      return;
    }
    if (skipBelow) return;
    const n = e.name;
    if (/^Trainerheader$/i.test(n) || /^Trainerfooter$/i.test(n)) {
      div = {};
      return;
    }
    if (/^Trainerdiv$/i.test(n)) {
      const l = divLabel(e);
      if (!l) return;
      const hi = headInfo(l);
      if (hi.games) div = { ver: hi.ver, ...(hi.games[0] === "old" ? { tag: "old" } : {}) };
      else if (/^Rematch/i.test(l) || WHEN.test(l)) div = { ...div, tag: l, section: undefined };
      else div = { section: l };
      return;
    }
    const c = ctx();
    if (/^Trainerentry(\/suffix)?$/i.test(n) || /^Trainerentry\/master$/i.test(n)) {
      closeParty();
      if (div.tag === "old" || c.games?.[0] === "old") return;
      const master = /master/i.test(n);
      const p = e.pos;
      const cls = cleanName(plain(p[1] ?? ""));
      const name = cleanName(plain(p[2] ?? "")) || undefined;
      const where = `${title}: ${cls} ${name ?? ""}`;
      const team: WikiMon[] = [];
      if (master) {
        // sprite|class|name|dex|species|gender|level|type|move|type|move…
        const s = wikiSpecies(p[3], p[4], where);
        const lv = Number(firstValue(p[6]));
        const moves: string[] = [];
        for (let k = 8; k < p.length; k += 2) {
          const mv = wikiMove(p[k], where);
          if (mv) moves.push(mv);
        }
        if (s && lv) team.push({ s, lv, m: moves.slice(0, 4) });
      } else {
        const count = Number(firstValue(p[4])) || 0;
        for (let k = 0; k < Math.max(count, 0) && k < 6; k++) {
          const b = 5 + k * 5;
          if (!p[b] && !p[b + 1]) break;
          const s = wikiSpecies(p[b] ?? "", p[b + 1] ?? "", where);
          const lv = Number(firstValue(p[b + 3]).replace(/[^0-9]/g, ""));
          const i = wikiItem(p[b + 4]);
          const dexForm = /^\s*\d+([A-Za-z])/.exec(p[b] ?? "")?.[1];
          if (!s || !lv) continue;
          const mon: WikiMon = { s, lv, m: [] };
          if (i) mon.i = i;
          if (dexForm) mon.fn = dexFormName(s, dexForm);
          if (!mon.fn) delete mon.fn;
          team.push(mon);
        }
      }
      if (!team.length) return;
      const gen = Number(e.named.game) || undefined;
      const blob = `${p[3] ?? ""} ${e.named.notes ?? ""}`;
      out.push({
        page: title,
        games: c.games,
        sprite: p[0],
        gen,
        ver: div.ver ?? c.ver,
        cls,
        name: name && name !== cls ? name : undefined,
        tag: div.tag ?? c.tag,
        section: div.section ?? c.section,
        double: /Double Battle|Multi Battle/i.test(blob) || PAIR_CLASS.test(cls) || / & | and /.test(name ?? "") || undefined,
        custom: master,
        team,
      });
      return;
    }
    if (/^Party(\/2)?$/.test(n) || /^Party\/(Single|Double|Multi|Tag)$/.test(n)) {
      closeParty();
      const a = e.named;
      // Partners who fight beside the player aren't opponents: drawn from
      // behind ("… Back.png"), or introduced as a partner right above the box.
      // Character-link templates ("{{Steven}} will work as the player's partner") name the partner.
      const gap = plain(text.slice(prevEnd, e.at).replace(/\{\{([A-Z][^|{}]*)\}\}/g, "$1"));
      const who = cleanName(plain(a.name ?? ""));
      if (/\bBack\b/i.test(a.sprite ?? "") || (who && gap.includes(who) && /\bpartner\b|teams? up with|joins? (the player|you)|on the player's side/i.test(gap))) {
        party = [];
        prevEnd = e.end;
        return;
      }
      const code = plain(a.game ?? "");
      let games: string[] | null = c.games;
      let ver = div.ver ?? c.ver;
      const codeGames = WIKI_GAMES.filter((g) => code in g.codes);
      if (code) {
        if (!codeGames.length) {
          // A code for a game we don't import (RGB, Pt, ZA…): skip the block.
          party = [];
          return;
        }
        games = codeGames.map((g) => g.key);
        const vs = codeGames.flatMap((g) => g.codes[code]);
        if (vs.length === 1) ver = vs[0];
      }
      if (c.games?.[0] === "old" && !codeGames.length) {
        party = [];
        return;
      }
      const cap = a.caption ?? "";
      const capInfo = headInfo(plain(cap).replace(/'/g, ""));
      if (capInfo.ver) ver = capInfo.ver;
      const tag = playerChoice(cap) ?? (cap && !capInfo.games ? plain(cap) || undefined : undefined) ?? div.tag ?? c.tag;
      const mk = (cls: string, name: string, suffixCls?: string): Found => {
        const nm = cleanName(plain(name)) || undefined;
        // SV writes "Rika of the Elite Four": the class follows the name (class2).
        const cl = cleanName(plain(cls)) || cleanName(plain(suffixCls ?? "").replace(/^(of )?(the )?/i, "")) || nm || "Trainer";
        return {
          page: title,
          games,
          fromCode: codeGames.length > 0,
          sprite: a.sprite,
          ver,
          cls: cl,
          name: nm && nm !== cl ? nm : undefined,
          tag,
          section: div.section ?? c.section,
          double: n === "Party/2" || /Double|Multi/i.test(`${n} ${cap} ${a.table ?? ""}`) || PAIR_CLASS.test(plain(cls)) || / & /.test(plain(name)) || undefined,
          custom: true,
          team: [],
        };
      };
      party = [mk(a.class ?? "", a.name ?? "", n === "Party/2" ? undefined : a.class2)];
      partyCounts = [Number(firstValue(a.pokemon)) || 6];
      if (n === "Party/2") {
        party.push(mk(a.class2 ?? "", a.name2 ?? ""));
        partyCounts.push(Number(firstValue(a.pokemon2)) || 6);
      }
      partyIdx = 0;
      return;
    }
    if (n === "Party/2/div") {
      partyIdx = 1;
      return;
    }
    if (/^Party(\/2)?\/end$/.test(n) || n === "Party/footer") {
      closeParty();
      return;
    }
    if (n === "Pokémon" && party) {
      if (!party.length) return;
      const cur = party[Math.min(partyIdx, party.length - 1)];
      if (party.length > 1 && partyIdx === 0 && cur.team.length >= partyCounts[0]) partyIdx = 1;
      const tgt = party[Math.min(partyIdx, party.length - 1)];
      const a = e.named;
      const where = `${title}: ${tgt.cls} ${tgt.name ?? ""}`;
      const s = wikiSpecies(a.ndex ?? "", a.pokemon ?? "", where);
      const lv = Number(firstValue(a.level).replace(/[^0-9]/g, ""));
      if (!s || !lv) return;
      const moves: string[] = [];
      for (const k of ["move1", "move2", "move3", "move4"]) {
        const mv = a[k] ? wikiMove(a[k], where) : undefined;
        if (mv && !moves.includes(mv)) moves.push(mv);
      }
      const mon: WikiMon = { s, lv, m: moves };
      const held = wikiItem(a.held);
      if (held) mon.i = held;
      const ab = plain(a.ability ?? "");
      if (ab && !/^(None|—|\?+)$/.test(ab)) mon.ab = ab;
      const tera = plain(a.tera ?? "");
      if (tera && /^[A-Z][a-z]+$/.test(tera)) mon.tt = tera;
      const form = plain(a.form ?? "").replace(/^-/, "");
      if (form && !/^(Male|Female|Shiny|all forms|Standard|Average Size)$/i.test(form)) mon.fn = form;
      const capV = headInfo(plain(a.caption ?? "").replace(/'/g, ""));
      if (capV.ver) mon.onlyVer = capV.ver;
      tgt.team.push(mon);
      return;
    }
  }
}

const DEX_FORMS: Record<string, string> = { A: "Alolan Form", G: "Galarian Form", H: "Hisuian Form", P: "Paldean Form" };
function dexFormName(species: number, letter: string): string | undefined {
  if (species === 550) return letter === "B" ? "Blue-Striped Form" : letter === "W" ? "White-Striped Form" : undefined;
  return DEX_FORMS[letter.toUpperCase()];
}

// ---------------------------------------------------------------------------
// Areas

/** Page title -> in-game area name ("Unova Route 4" -> "Route 4", "Pokémon League (Paldea)" -> "Pokémon League"). */
export function areaName(title: string): string {
  return title
    .replace(/\/.*$/, "")
    .replace(/^(Unova|Kalos|Hoenn|Alola|Kanto|Galar|Sinnoh|Paldea|Johto) (Route \d+.*)$/, "$2")
    .replace(/ \((Unova|Kalos|Hoenn|Alola|Kanto|Galar|Sinnoh|Paldea|Kitakami|Blueberry Academy|Isle of Armor|Crown Tundra|location|place|Sevii Islands|game|anime|[^)]*\b(Black|White|X and Y|Sun|Moon|Sword|Shield|Scarlet|Violet|Diamond|Pearl|Ruby|Sapphire|Let's Go)\b[^)]*)\)$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Import

const sig = (t: { cls: string; name?: string; team: TrainerMon[] }) => `${t.cls}|${t.name ?? ""}|${t.team.map((m) => `${m.s}:${m.lv}:${m.m.join("+")}:${m.i ?? ""}:${m.fn ?? ""}`).join(",")}`;
const idPart = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[♂]/g, "M")
    .replace(/[♀]/g, "F")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export async function importWikiGame(key: string): Promise<{ raw: RawTeam[]; pages: number; skipped: number }> {
  const g = GAME.get(key)!;
  // Pages per region (first category wins, so DLC areas keep their own region).
  const regionOf = new Map<string, string>();
  for (const [cat, region] of g.cats) {
    const pages = await categoryTree(cat, 2, /Dens$|Power Spots|Wild Area News/);
    for (const p of pages) if (!regionOf.has(p)) regionOf.set(p, region);
  }
  for (const p of [...regionOf.keys()]) if (SKIP_PAGE.test(p) || /\/Dens$|\/\d{4}$/.test(p)) regionOf.delete(p);
  // Subpages that hold battles but sit outside the categories.
  for (const [p, region] of EXTRA_PAGES[key] ?? []) regionOf.set(p, region);
  const texts = await wikitextMany([...regionOf.keys()]);
  // Which of the region's games each page belongs to, by Bulbapedia's per-game categories.
  const regionGames = (region: string) => WIKI_GAMES.filter((x) => x.cats.some(([, r]) => r === region)).map((x) => x.key);
  const inGameCat = new Map<string, Set<string>>();
  for (const x of WIKI_GAMES) if (x.cats.some(([, r]) => g.cats.some(([, r2]) => r2 === r))) inGameCat.set(x.key, new Set(await categoryMembers(x.gameCat)));
  const found: (Found & { region: string })[] = [];
  let skipped = 0;
  for (const [title, region] of regionOf) {
    const page = texts.get(title);
    if (!page?.text) continue;
    const rows = pageTrainers(page.title, page.text);
    // Rows under no game heading: the page's game categories, else the games its {{Party}} codes name, else every game of the region.
    const byCat = regionGames(region).filter((k) => inGameCat.get(k)?.has(page.title) || inGameCat.get(k)?.has(title));
    const byCode = [...new Set(rows.filter((r) => r.fromCode).flatMap((r) => r.games ?? []))].filter((k) => regionGames(region).includes(k));
    // Kanto, Hoenn and Sinnoh pages also cover the Gen I–IV games, so an
    // unheaded page outside every new game's category belongs to those.
    const pageGames = byCat.length ? byCat : byCode.length ? byCode : OLD_REGIONS.has(region) ? [] : regionGames(region);
    for (const f of rows) {
      let games = f.games ?? pageGames;
      if (f.games && f.games.length > 1 && !f.fromCode && byCat.length) games = games.filter((k) => byCat.includes(k));
      games = games.filter((k) => GAME.get(k)?.cats.some(([, r]) => r === region));
      if (f.gen) games = games.filter((k) => GAME.get(k)!.gen === f.gen);
      if (games.length > 1 && f.sprite) {
        const bySprite = spriteGames(f.sprite).filter((k) => games.includes(k));
        if (bySprite.length) games = bySprite;
      }
      if (!games.includes(key)) continue;
      // Rows shared by the two games of a region (a "Generation V" heading
      // on a page in both games' categories) are kept for both.
      if (!f.games && games.length > 1) {
        skipped++;
        if (process.env.WIKI_DEBUG) console.error(`shared row: ${page.title}: ${f.cls} ${f.name ?? ""}`);
      }
      found.push({ ...f, region, ...(/\/Title Defense$/.test(page.title) ? { section: "Title defense" } : {}) });
    }
  }

  // Version-only members split a team into one team per version.
  const expanded: (Found & { region: string })[] = [];
  for (const f of found) {
    const only = [...new Set(f.team.map((m) => m.onlyVer).filter(Boolean) as string[])];
    if (!only.length) {
      expanded.push(f);
      continue;
    }
    for (const v of g.versions) {
      if (f.ver && f.ver !== v) continue;
      expanded.push({ ...f, ver: v, team: f.team.filter((m) => !m.onlyVer || m.onlyVer === v) });
    }
  }

  // Merge the same battle listed on several pages; give ids and groups.
  const merged = new Map<string, { f: Found & { region: string }; places: RawPlace[] }>();
  for (const f of expanded) {
    for (const m of f.team) delete m.onlyVer;
    if (f.ver && !g.versions.includes(f.ver)) continue;
    const k = `${sig(f)}|${f.ver ?? ""}|${f.tag ?? ""}`;
    const place: RawPlace = { area: areaName(f.page), region: f.region, ...(f.section ? { section: f.section.slice(0, 60) } : {}) };
    const cur = merged.get(k);
    if (cur) {
      if (!cur.places.some((p) => p.area === place.area && p.section === place.section)) cur.places.push(place);
    } else merged.set(k, { f, places: [place] });
  }

  const ids = new Map<string, number>();
  const raw: RawTeam[] = [];
  for (const { f, places } of merged.values()) {
    const base = `${idPart(areaName(f.page))}-${idPart(f.cls)}${f.name ? `_${idPart(f.name)}` : ""}`;
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    const team: TrainerMon[] = f.team.map((m) => {
      if (m.m.length || !g.vg || f.custom) return m;
      const ls = learnset(g.vg, m.s, m.fn);
      if (!ls.length) return m;
      return { ...m, m: defaultMoves(m.lv, ls, [], false), d: 1 as const };
    });
    const genericName = !f.name || /^(Grunt|Grunts|Employee|Trainer|Member|Admin|Scientist)$/i.test(f.name);
    raw.push({
      id,
      clsConst: f.cls,
      cls: f.cls,
      name: f.name,
      places,
      tag: f.tag?.replace(/^Rematches$/i, "Rematch").replace(/^First battles$/i, "First battle").replace(/^Pre–Hall of Fame$/, "Before the Hall of Fame").replace(/^Post–Hall of Fame$/, "After the Hall of Fame").replace(/^If you chose dark$/, "If you chose the Tower of Darkness").replace(/^If you chose water$/, "If you chose the Tower of Waters"),
      group: genericName ? undefined : `${idPart(areaName(f.page))}-${idPart(f.cls)}_${idPart(f.name!)}`,
      ver: f.ver ? [f.ver] : undefined,
      double: f.double,
      team,
    });
  }
  const byGroup = new Map<string, RawTeam[]>();
  for (const t of raw) if (t.group) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
  // The wiki captions only the first of a side-by-side pair of starter
  // variants ("If you chose Snivy" over Bianca, none over Cheren beside her):
  // read the missing ones off the species each variant uses elsewhere.
  const choiceBySpecies = new Map<string, Map<number, Set<string>>>();
  for (const t of raw) {
    if (!t.tag?.startsWith("If you chose") || !t.name) continue;
    const k = `${t.cls}|${t.name}`;
    if (!choiceBySpecies.has(k)) choiceBySpecies.set(k, new Map());
    for (const m of t.team) {
      const set = choiceBySpecies.get(k)!.get(m.s) ?? new Set<string>();
      set.add(t.tag);
      choiceBySpecies.get(k)!.set(m.s, set);
    }
  }
  for (const list of byGroup.values()) {
    if (list.length < 2) continue;
    for (const t of list) {
      if (t.tag) continue;
      const map = choiceBySpecies.get(`${t.cls}|${t.name}`);
      const tags = new Set(t.team.flatMap((m) => (map?.get(m.s)?.size === 1 ? [...map.get(m.s)!] : [])));
      if (tags.size === 1) t.tag = [...tags][0];
    }
  }
  // Rematches: number them in page order when one trainer has several.
  for (const list of byGroup.values()) {
    const re = list.filter((t) => t.tag && /^Rematch$/i.test(t.tag));
    if (re.length > 1) re.forEach((t, i) => (t.tag = `Rematch ${i + 1}`));
  }
  return { raw, pages: texts.size, skipped };
}

async function main() {
  const want = process.argv.slice(2);
  const OUT = path.join(process.cwd(), "src/data/trainers");
  for (const tg of TRAINER_GAMES) {
    if (!GAME.has(tg.key)) continue;
    if (want.length && !want.includes(tg.key)) continue;
    problems.length = 0;
    const { raw, pages, skipped } = await importWikiGame(tg.key);
    if (problems.length) {
      const uniq = [...new Set(problems)];
      console.error(`${tg.key}: ${uniq.length} unresolved names\n  ${uniq.slice(0, 40).join("\n  ")}`);
      if (!process.env.WIKI_ALLOW_UNRESOLVED) process.exitCode = 1;
    }
    const file = assemble(tg.key, { repo: "bulbapedia.bulbagarden.net", commit: `fetched ${new Date().toISOString().slice(0, 10)}` }, raw, (t) => notableFor(tg.key, t.clsConst, t.name, t.cls));
    const json = JSON.stringify(file);
    fs.writeFileSync(path.join(OUT, `${tg.key}.json`), json + "\n");
    console.log(`${tg.key}: ${file.teams.length} teams, ${file.areas.length} areas from ${pages} pages (${skipped} unheaded rows shared with the region's other game), ${(json.length / 1024).toFixed(0)} KB`);
  }
}

if (process.argv[1] && /wiki-import\.ts$/.test(process.argv[1])) void main();
void categoryMembers;
