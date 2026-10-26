/**
 * Gen III (pret/pokeruby, pret/pokeemerald, pret/pokefirered).
 *
 *   src/data/trainers*.h            – gTrainers: class, name, items, double battle, party
 *   src/data/trainer_parties.h      – parties (iv, lvl, species, heldItem, moves)
 *   src/data/text/trainer_class_names*.h
 *   src/data/pokemon/level_up_learnset*.h – default movesets (GiveBoxMonInitialMoveset)
 *   data/maps/<Map>/map.json        – region_map_section + object event scripts
 *   data/maps/<Map>/scripts.inc, data/scripts/*.inc – trainerbattle_* commands
 *   src/data/region_map/region_map_sections.json – MAPSEC names
 *   rematch tables: gRematchTable (Emerald), gTrainerEyeTrainers (Ruby/Sapphire), sRematches (FireRed/LeafGreen)
 *   constants/version.inc (Ruby/Sapphire) – trainers that differ by version
 */
import fs from "node:fs";
import path from "node:path";
import { defaultMoves, itemRef, moveSlug, speciesId, titleConstant, titleName, type Learnset } from "./common";
import type { RawPlace, RawTeam } from "./model";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");
const exists = (root: string, f: string) => fs.existsSync(path.join(root, f));

type Game3 = "ruby-sapphire" | "emerald" | "firered-leafgreen";

/** Split a C initializer body on top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{" || ch === "(") depth++;
    if (ch === "}" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Expand simple multi-line object-like #defines (FireRed's DUMMY_TRAINER_MON). */
function expandDefines(text: string): string {
  const defs = new Map<string, string>();
  const body = text.replace(/^#define\s+(\w+)\s+((?:.*\\\n)*.*)$/gm, (_, name: string, val: string) => {
    defs.set(name, val.replace(/\\\n/g, " "));
    return "";
  });
  if (!defs.size) return body;
  return body.replace(/\b[A-Z_][A-Z0-9_]*\b/g, (w) => defs.get(w) ?? w);
}

export interface Gen3Mon {
  species: string;
  level: number;
  iv?: number;
  item?: string;
  moves?: string[];
}

/** Parse every `struct TrainerMon… sParty_X[] = { {…}, … };` */
export function parseGen3Parties(text: string): Map<string, { custom: boolean; mons: Gen3Mon[] }> {
  const src = expandDefines(stripC(text));
  const out = new Map<string, { custom: boolean; mons: Gen3Mon[] }>();
  const re = /struct\s+(TrainerMon\w*)\s+(\w+)\s*\[\]\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (depth && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const inner = src.slice(re.lastIndex, i - 1);
    const custom = /CustomMoves/.test(m[1]);
    const mons: Gen3Mon[] = [];
    for (const entry of splitTop(inner)) {
      const e = entry.replace(/^\{|\}$/g, "");
      const mon: Partial<Gen3Mon> = {};
      // Ruby writes `.moves = A, B, C, D` without braces: fold those back into the moves field.
      const fields = splitTop(e);
      let last = "";
      for (const f of fields) {
        const kv = /^\.(\w+)\s*=\s*([\s\S]*)$/.exec(f);
        if (!kv) {
          if (last === "moves") (mon.moves ??= []).push(f.trim());
          continue;
        }
        last = kv[1];
        const v = kv[2].trim();
        if (kv[1] === "species") mon.species = v;
        else if (kv[1] === "lvl" || kv[1] === "level") mon.level = Number(v);
        else if (kv[1] === "iv") mon.iv = Number(v);
        else if (kv[1] === "heldItem") mon.item = v;
        else if (kv[1] === "moves") mon.moves = v.replace(/[{}]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
      }
      if (!mon.species || !mon.level) throw new Error(`Bad party entry in ${m[2]}: ${e.slice(0, 120)}`);
      if (mon.moves) mon.moves = mon.moves.filter((x) => x !== "MOVE_NONE");
      mons.push(mon as Gen3Mon);
    }
    out.set(m[2], { custom, mons });
  }
  return out;
}

export interface Gen3Trainer {
  id: string;
  cls: string;
  name: string;
  items: string[];
  double: boolean;
  party: string;
}

/** gTrainers: [TRAINER_X] = { .trainerClass = …, .trainerName = _("…"), … .party = …(sParty_X) } */
export function parseGen3Trainers(text: string): Gen3Trainer[] {
  const src = stripC(text);
  const out: Gen3Trainer[] = [];
  const re = /\[(TRAINER_\w+)\]\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (depth && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    const cls = /\.trainerClass\s*=\s*(\w+)/.exec(body)?.[1] ?? "";
    const name = /\.trainerName\s*=\s*_\("([^"]*)"\)/.exec(body)?.[1] ?? "";
    const items = (/\.items\s*=\s*\{([^}]*)\}/.exec(body)?.[1] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && x !== "ITEM_NONE");
    const double = /\.doubleBattle\s*=\s*TRUE/.test(body);
    const party = /\.party\s*=\s*(?:\w+\((\w+)\)|\{\s*\.\w+\s*=\s*(\w+)\s*\})/.exec(body);
    out.push({ id: m[1], cls, name, items, double, party: party?.[1] ?? party?.[2] ?? "" });
  }
  return out;
}

/** LEVEL_UP_MOVE( 1, MOVE_TACKLE) arrays by label. */
export function parseGen3Learnsets(text: string): Map<string, Learnset> {
  const out = new Map<string, Learnset>();
  for (const m of stripC(text).matchAll(/(\w+LevelUpLearnset)\s*\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    const list: Learnset = [];
    for (const e of m[2].matchAll(/LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)/g)) list.push({ level: Number(e[1]), move: moveSlug(e[2]) });
    out.set(m[1], list);
  }
  return out;
}

/** Label blocks of .inc scripts -> trainerbattle constants, with the version a line is compiled for (Ruby/Sapphire). */
export function parseScriptBlocks(text: string): Map<string, { id: string; ver: "both" | "sapphire" | "ruby" }[]> {
  const out = new Map<string, { id: string; ver: "both" | "sapphire" | "ruby" }[]>();
  let label = "";
  const stack: ("sapphire" | "ruby" | "both")[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/@.*$/, "").trim();
    const lab = /^(\w+):{1,2}/.exec(line);
    if (lab) {
      label = lab[1];
      if (!out.has(label)) out.set(label, []);
      continue;
    }
    if (/^\.ifdef SAPPHIRE/.test(line)) stack.push("sapphire");
    else if (/^\.ifndef SAPPHIRE/.test(line)) stack.push("ruby");
    else if (/^\.if(n?def)?\b/.test(line)) stack.push("both");
    else if (/^\.else/.test(line)) {
      const top = stack.pop();
      stack.push(top === "sapphire" ? "ruby" : top === "ruby" ? "sapphire" : "both");
    } else if (/^\.end(if|c)\b/.test(line)) stack.pop();
    if (!label || !/^trainerbattle/.test(line)) continue;
    const ver = [...stack].reverse().find((v) => v !== "both") ?? "both";
    for (const id of line.match(/\bTRAINER_\w+/g) ?? []) {
      if (/^TRAINER_BATTLE_/.test(id)) continue;
      out.get(label)!.push({ id, ver });
    }
  }
  return out;
}

const STARTERS: Record<string, string> = { TREECKO: "If you chose Mudkip", TORCHIC: "If you chose Treecko", MUDKIP: "If you chose Torchic", BULBASAUR: "If you chose Squirtle", CHARMANDER: "If you chose Bulbasaur", SQUIRTLE: "If you chose Charmander" };

export function importGen3(root: string, game: Game3): RawTeam[] {
  const isRuby = game === "ruby-sapphire";
  const isFrlg = game === "firered-leafgreen";
  const trainersFile = isRuby ? "src/data/trainers_en.h" : "src/data/trainers.h";
  const trainers = parseGen3Trainers(read(root, trainersFile));
  const parties = parseGen3Parties(read(root, "src/data/trainer_parties.h"));

  // Class names.
  const classNames = new Map<string, string>();
  if (isRuby) {
    const order = /enum\s*\{\s*(TRAINER_CLASS_POKEMON_TRAINER_1[\s\S]*?)\}/.exec(read(root, "include/constants/trainers.h"))![1].split(",").map((x) => x.trim()).filter(Boolean);
    const names = [...read(root, "src/data/text/trainer_class_names_en.h").matchAll(/_\("([^"]*)"\)/g)].map((m) => m[1]);
    order.forEach((c, i) => classNames.set(c, names[i]));
  } else {
    for (const m of read(root, "src/data/text/trainer_class_names.h").matchAll(/\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("([^"]*)"\)/g)) classNames.set(m[1], m[2]);
  }

  // Learnsets.
  const lsByLabel = parseGen3Learnsets(read(root, "src/data/pokemon/level_up_learnsets.h"));
  const learnsetOf = new Map<string, Learnset>();
  const ptrs = read(root, "src/data/pokemon/level_up_learnset_pointers.h");
  const named = [...ptrs.matchAll(/\[(SPECIES_\w+)\]\s*=\s*(\w+)/g)];
  if (named.length) for (const m of named) learnsetOf.set(m[1], lsByLabel.get(m[2]) ?? []);
  else {
    const list = [...ptrs.matchAll(/^\s*(\w+LevelUpLearnset),/gm)].map((m) => m[1]);
    const species = [...read(root, "include/constants/species.h").matchAll(/#define\s+(SPECIES_\w+)\s+(\d+)/g)];
    for (const [, s, n] of species) if (list[Number(n)]) learnsetOf.set(s, lsByLabel.get(list[Number(n)]) ?? []);
  }

  // MAPSEC names (+ Sevii membership for FireRed/LeafGreen).
  const secs = JSON.parse(read(root, "src/data/region_map/region_map_sections.json")).map_sections as { id: string; name?: string }[];
  const secName = new Map(secs.filter((s) => s.name).map((s) => [s.id, mapsecTitle(s.name!)]));
  const sevii = new Set<string>();
  if (isFrlg) for (const f of fs.readdirSync(path.join(root, "src/data/region_map")).filter((x) => /sevii/.test(x))) for (const m of read(root, `src/data/region_map/${f}`).matchAll(/MAPSEC_\w+/g)) sevii.add(m[0]);

  // Version aliases (Ruby/Sapphire).
  const alias = new Map<string, { sapphire?: string; ruby?: string }>();
  if (isRuby && exists(root, "constants/version.inc")) {
    let ver: "sapphire" | "ruby" | null = null;
    for (const raw of read(root, "constants/version.inc").split("\n")) {
      const l = raw.trim();
      if (l.startsWith(".ifdef SAPPHIRE")) ver = "sapphire";
      else if (l.startsWith(".else")) ver = ver === "sapphire" ? "ruby" : ver;
      else if (/^\.endi?f|^\.endc/.test(l)) ver = null;
      const m = /^\.set\s+(TRAINER_\w+),\s*(TRAINER_\w+)/.exec(l);
      if (m && ver) alias.set(m[1], { ...alias.get(m[1]), [ver]: m[2] });
    }
  }

  // Script blocks across every .inc under data/.
  const blocks = new Map<string, { id: string; ver: "both" | "sapphire" | "ruby" }[]>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".inc")) for (const [k, v] of parseScriptBlocks(fs.readFileSync(p, "utf8"))) blocks.set(k, [...(blocks.get(k) ?? []), ...v]);
    }
  };
  walk(path.join(root, "data/maps"));
  walk(path.join(root, "data/scripts"));

  const known = new Set(trainers.map((t) => t.id));
  const spots = new Map<string, { place: RawPlace; ver: Set<string> }[]>();
  const versionsAll = isRuby ? ["ruby", "sapphire"] : [];
  const addSpot = (id: string, place: RawPlace, vers: string[]) => {
    const list = spots.get(id) ?? [];
    let hit = list.find((x) => x.place.area === place.area && x.place.section === place.section);
    if (!hit) list.push((hit = { place, ver: new Set() }));
    vers.forEach((v) => hit!.ver.add(v));
    spots.set(id, list);
  };
  const mapPlace = new Map<string, RawPlace>();
  const mapsDir = path.join(root, "data/maps");
  for (const dir of fs.readdirSync(mapsDir)) {
    const mj = path.join(mapsDir, dir, "map.json");
    if (!fs.existsSync(mj)) continue;
    if (/^(BattleFrontier_|TrainerHill_|BattleTower|BattlePyramid|TrainerTower|RecordCorner|UnionRoom|SingleBattleColosseum|DoubleBattleColosseum|LinkContest|TradeCenter)/.test(dir)) continue;
    const map = JSON.parse(fs.readFileSync(mj, "utf8"));
    const area = secName.get(map.region_map_section);
    if (!area) continue;
    const region = isFrlg ? (sevii.has(map.region_map_section) || /^(One|Two|Three|Four|Five|Six|Seven)Island|^NavelRock|^BirthIsland/.test(dir) ? "Sevii Islands" : "Kanto") : "Hoenn";
    // Ruby/Sapphire file both hideouts under one "HIDEOUT" section.
    const realArea = area === "Hideout" ? (/^MagmaHideout/.test(dir) ? "Magma Hideout" : "Aqua Hideout") : area;
    const place: RawPlace = { area: realArea, region, section: gen3Section(realArea, map.name) };
    mapPlace.set(map.id, place);
    const labels = new Set<string>();
    for (const o of [...(map.object_events ?? []), ...(map.coord_events ?? []), ...(map.bg_events ?? [])]) if (o.script) labels.add(o.script);
    const scriptsInc = path.join(mapsDir, dir, "scripts.inc");
    if (fs.existsSync(scriptsInc)) for (const k of parseScriptBlocks(fs.readFileSync(scriptsInc, "utf8")).keys()) labels.add(k);
    for (const l of labels) {
      for (const ref of blocks.get(l) ?? []) {
        const resolved = alias.get(ref.id);
        if (resolved) {
          for (const v of ["sapphire", "ruby"] as const) if (resolved[v] && (ref.ver === "both" || ref.ver === v)) addSpot(resolved[v]!, place, [v]);
        } else if (known.has(ref.id)) addSpot(ref.id, place, ref.ver === "both" ? versionsAll : [ref.ver]);
      }
    }
  }

  // Rematch tables: id -> [base id, rematch number, map].
  const rematch = new Map<string, { base: string; n: number; map: string }>();
  const addRematch = (ids: string[], map: string) => {
    const real = ids.filter((x) => x !== "SKIP");
    const seen = new Set<string>();
    let n = 0;
    for (const id of real) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (id !== real[0]) rematch.set(id, { base: real[0], n: ++n, map });
    }
  };
  if (game === "emerald") {
    for (const m of read(root, "src/battle_setup.c").matchAll(/REMATCH\(([^)]*)\)/g)) {
      const parts = m[1].split(",").map((x) => x.trim());
      if (parts.length === 6 && parts[0].startsWith("TRAINER_")) addRematch(parts.slice(0, 5), parts[5]);
    }
  } else if (isRuby) {
    for (const m of read(root, "src/battle_setup.c").matchAll(/\{\s*\{([^}]*)\},\s*MAP_GROUP\((\w+)\)/g)) addRematch(m[1].split(",").map((x) => x.trim()), m[2]);
  } else {
    for (const m of read(root, "src/vs_seeker.c").matchAll(/\{\s*\{([^}]*)\},\s*MAP\((\w+)\)/g)) addRematch(m[1].split(",").map((x) => x.trim()), m[2]);
  }

  const out: RawTeam[] = [];
  for (const t of trainers) {
    if (t.id === "TRAINER_NONE") continue;
    let places = spots.get(t.id) ?? [];
    const rm = rematch.get(t.id);
    if (!places.length && rm) {
      places = spots.get(rm.base) ?? [];
      if (!places.length && mapPlace.get(rm.map)) places = [{ place: mapPlace.get(rm.map)!, ver: new Set(versionsAll) }];
    }
    if (!places.length) continue; // never battled from a map script: unused or built at run time (Battle Frontier, Trainer Hill…)
    const party = parties.get(t.party);
    if (!party) throw new Error(`No party ${t.party} for ${t.id}`);
    const team = party.mons.map((m) => {
      const ls = learnsetOf.get(m.species);
      if (!ls) throw new Error(`No learnset for ${m.species}`);
      const custom = party.custom && m.moves !== undefined;
      return {
        s: speciesId(m.species),
        lv: m.level,
        m: custom ? m.moves!.map(moveSlug) : defaultMoves(m.level, ls),
        ...(custom ? {} : { d: 1 as const }),
        ...(m.item && m.item !== "ITEM_NONE" ? { i: itemRef(m.item) } : {}),
      };
    });
    const vers = new Set(places.flatMap((p) => [...p.ver]));
    const ver = isRuby && vers.size === 1 ? [...vers] : undefined;
    let tag: string | undefined = rm ? `Rematch ${rm.n}` : /_REMATCH(_|$)|^TRAINER_ELITE_FOUR_\w+_2$|^TRAINER_CHAMPION_REMATCH/.test(t.id) ? "Rematch" : undefined;
    const starter = /_(TREECKO|TORCHIC|MUDKIP|BULBASAUR|CHARMANDER|SQUIRTLE)$/.exec(t.id)?.[1];
    if (starter) tag = STARTERS[starter];
    const clsName = classNames.get(t.cls) ?? titleConstant(t.cls.replace(/^TRAINER_CLASS_/, ""));
    out.push({
      id: t.id.replace(/^TRAINER_/, ""),
      clsConst: t.cls,
      cls: gen3ClassName(clsName),
      // FireRed/LeafGreen's rival is named by the player (the data holds a placeholder).
      ...(t.name && !(isFrlg && /^TRAINER_(RIVAL|CHAMPION)_/.test(t.id)) ? { name: titleName(t.name) } : {}),
      places: places.map((p) => p.place),
      tag,
      ver,
      double: t.double,
      items: t.items.map((i) => itemRef(i)),
      team,
    });
  }
  return out;
}

export function mapsecTitle(name: string): string {
  return titleName(name.replace(/\{[^}]*\}/g, "").replace(/POKé/g, "POKé"))
    .replace(/\bS\. S\./g, "S.S.")
    .replace(/\bMt\. ?/g, "Mt. ")
    .replace(/\bPokémon\b/gi, "Pokémon");
}

const fold = (w: string) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The map's place inside its MAPSEC area: "RustboroCity_Gym" in "Rustboro City" -> "Gym",
 * "FiveIsland_LostCave_Room10" in "Lost Cave" -> "Room 10", "PokemonLeague_LoreleisRoom" -> "Lorelei's Room".
 */
export function gen3Section(area: string, mapName: string): string | undefined {
  const words = mapName
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/(\d)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const a = area.split(/\s+/).map(fold).filter(Boolean);
  const w = words.map(fold);
  let rest = words;
  for (let i = w.length - a.length; i >= 0; i--) {
    if (a.every((x, j) => w[i + j] === x)) {
      rest = words.slice(i + a.length);
      break;
    }
  }
  const out = rest
    .join(" ")
    .replace(/\b(\w+)s (Room|Lab|Cave|House)\b/g, "$1's $2")
    .replace(/\bPokemon\b/g, "Pokémon")
    .trim();
  return out || undefined;
}

function gen3ClassName(n: string): string {
  return titleName(n.replace(/\{PKMN\}/g, "PKMN")).replace(/^Pokémon Trainer$/, "Pokémon Trainer");
}
