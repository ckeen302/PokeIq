/**
 * Platinum (pret/pokeplatinum).
 *
 *   res/trainers/data/<trainer>.json   – class, name, items, double battle, party (species, form, level, item, moves)
 *   generated/trainer_classes.txt + res/text/trainer_class_names.json – printed class names
 *   res/pokemon/<species>/data.json    – level-up learnsets (forms under forms/<form>/data.json)
 *   include/data/map_headers.h         – map -> events file, scripts file, location name
 *   res/field/events/events_<map>.json – trainers standing on the map ("script": "TRAINER_X")
 *   res/field/scripts/scripts_<map>.s  – scripted battles (StartTrainerBattle, SetVar …, TRAINER_X)
 *   res/text/location_names.json       – location names
 */
import fs from "node:fs";
import path from "node:path";
import { defaultMoves, itemRef, moveSlug, speciesId, titleName, type Learnset } from "./common";
import type { RawPlace, RawTeam } from "./model";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");

interface PtMon {
  species: string;
  form: number;
  level: number;
  item: string | null;
  moves: string[] | null;
}
interface PtTrainer {
  name: string;
  class: string;
  items: string[];
  double_battle: boolean;
  party: PtMon[];
}

/** Partner-only teams: they fight beside the player, never against them. */
export const PT_PARTNER = /^TRAINER_(DAWN|LUCAS)_|^TRAINER_RIVAL_(FIGHT_AREA|SPEAR_PILLAR)_|^TRAINER_(CHERYL|MIRA|RILEY|MARLEY|BUCK)_(?!BATTLEGROUND)|_UNUSED$/;

const RIVAL_TAG: Record<string, string> = { TURTWIG: "If you chose Piplup", CHIMCHAR: "If you chose Turtwig", PIPLUP: "If you chose Chimchar" };
const FORM_LEARNSET: Record<string, Record<number, string>> = { SPECIES_WORMADAM: { 1: "sandy", 2: "trash" } };

/** Map header blocks: name -> fields. */
export function parseHeaders(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const m of text.matchAll(/\[(MAP_\w+)\]\s*=\s*\{([\s\S]*?)\n\s*\},/g)) {
    const f: Record<string, string> = {};
    for (const kv of m[2].matchAll(/\.(\w+)\s*=\s*([^,\n]+),/g)) f[kv[1]] = kv[2].trim();
    out.set(m[1], f);
  }
  return out;
}

/** "MAP_HEADER_STARK_MOUNTAIN_ROOM_2" inside "Stark Mountain" -> "Room 2". */
export function headerSection(area: string, header: string): string | undefined {
  const words = header
    .replace(/^MAP_(HEADER_)?/, "")
    .replace(/\bMOUNT_/g, "MT_")
    .split("_")
    .filter(Boolean);
  const fold = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = area.split(/\s+/).map(fold).filter(Boolean);
  const w = words.map(fold);
  let rest = words;
  for (let i = w.length - a.length; i >= 0; i--) {
    if (a.every((x, j) => w[i + j] === x)) {
      rest = words.slice(i + a.length);
      break;
    }
  }
  // A map named apart from its area ("MAP_VIOLET_GYM" in Violet City) keeps its whole name.
  const s = rest
    .map((x) => (/^(B?\d+F|\d+)$/.test(x) ? x : x === "MT" ? "Mt." : x.charAt(0) + x.slice(1).toLowerCase()))
    .join(" ")
    .replace(/\bPokecenter\b/g, "Pokémon Center")
    .replace(/\bPokemon\b/g, "Pokémon")
    .replace(/\bDp\b/g, "DP")
    .replace(/\b(Aaron|Bertha|Flint|Lucian|Lance|Will|Karen|Koga|Bruno|Champion|Lorelei|Agatha|Sidney|Phoebe|Glacia|Drake) Room\b/g, "$1's Room")
    .replace(/ (And|To|Of|The) /g, (m) => m.toLowerCase())
    .trim();
  if (fold(s) === a.join("") || s.split(" ").every((x) => a.includes(fold(x)))) return undefined;
  return s || undefined;
}

export function importPlatinum(root: string): RawTeam[] {
  const consts = read(root, "generated/trainers.txt").split("\n").map((s) => s.trim()).filter(Boolean);
  const classOrder = read(root, "generated/trainer_classes.txt").split("\n").map((s) => s.trim()).filter(Boolean);
  const classText = JSON.parse(read(root, "res/text/trainer_class_names.json")).messages as { en_US: string }[];
  const className = (c: string) => {
    const t = classText[classOrder.indexOf(c)]?.en_US ?? c;
    return t.replace(/₧₦/g, "Pokémon");
  };
  const locText = new Map((JSON.parse(read(root, "res/text/location_names.json")).messages as { id: string; en_US: string }[]).map((m) => [m.id, m.en_US]));
  const headers = parseHeaders(read(root, "include/data/map_headers.h"));

  const spots = new Map<string, RawPlace[]>();
  const add = (id: string, p: RawPlace) => {
    const l = spots.get(id) ?? [];
    if (!l.some((x) => x.area === p.area && x.section === p.section)) l.push(p);
    spots.set(id, l);
  };
  for (const [name, h] of headers) {
    const area = locText.get(h.mapLabelTextID ?? "");
    if (!area || area === "Mystery Zone") continue;
    // Battle Frontier facilities draw trainers at run time; the _DP_ maps are Diamond/Pearl leftovers Platinum never loads.
    if (/BATTLE_(TOWER|FACTORY|HALL|CASTLE|ARCADE)|UNION_ROOM|COLOSSEUM|_DP_/.test(name)) continue;
    const place: RawPlace = { area, region: "Sinnoh", section: headerSection(area, name) };
    const ev = h.eventsArchiveID && path.join(root, "res/field/events", `${h.eventsArchiveID}.json`);
    if (ev && fs.existsSync(ev)) for (const m of fs.readFileSync(ev, "utf8").matchAll(/"script":\s*"(TRAINER_\w+)"/g)) add(m[1], place);
    const sc = h.scriptsArchiveID && path.join(root, "res/field/scripts", `${h.scriptsArchiveID}.s`);
    if (sc && fs.existsSync(sc)) {
      for (const line of fs.readFileSync(sc, "utf8").split("\n")) {
        const l = line.trim();
        const cmd = l.split(/\s+/)[0];
        if (!["StartTrainerBattle", "SetVar", "StartTagBattle", "StartFirstBattle"].includes(cmd)) continue;
        let ids = l.match(/\bTRAINER_[A-Z0-9_]+/g) ?? [];
        if (cmd === "StartTagBattle") ids = (l.replace(/^StartTagBattle\s+/, "").split(",").slice(1).join(",").match(/\bTRAINER_[A-Z0-9_]+/g) ?? []);
        for (const id of ids) add(id, place);
      }
    }
  }

  // Learnsets.
  const learnsets = new Map<string, Learnset>();
  const learnsetOf = (species: string, form: number): Learnset => {
    const formName = FORM_LEARNSET[species]?.[form];
    const key = `${species}:${formName ?? ""}`;
    let ls = learnsets.get(key);
    if (!ls) {
      const dir = species.replace(/^SPECIES_/, "").toLowerCase();
      const file = formName ? `res/pokemon/${dir}/forms/${formName}/data.json` : `res/pokemon/${dir}/data.json`;
      const data = JSON.parse(read(root, file));
      ls = (data.learnset.by_level as [number, string][]).map(([level, move]) => ({ level, move: moveSlug(move) }));
      learnsets.set(key, ls);
    }
    return ls;
  };

  const out: RawTeam[] = [];
  for (const id of consts) {
    if (id === "TRAINER_NONE" || id === "MAX_TRAINERS" || PT_PARTNER.test(id)) continue;
    const file = path.join(root, "res/trainers/data", `${id.replace(/^TRAINER_/, "").toLowerCase()}.json`);
    if (!fs.existsSync(file)) throw new Error(`No trainer file for ${id}`);
    const t = JSON.parse(fs.readFileSync(file, "utf8")) as PtTrainer;
    let places = spots.get(id) ?? [];
    let tag: string | undefined;
    const rm = /^(TRAINER_\w+?)_REMATCH(?:_(\d+))?$/.exec(id);
    if (rm) {
      tag = rm[2] ? `Rematch ${rm[2]}` : "Rematch";
      if (!places.length) places = spots.get(rm[1]) ?? [];
    }
    if (!places.length) continue;
    const starter = /^TRAINER_RIVAL_\w+_(TURTWIG|CHIMCHAR|PIPLUP)$/.exec(id)?.[1];
    if (starter) tag = RIVAL_TAG[starter];
    const team = t.party.map((m) => {
      const custom = Array.isArray(m.moves);
      return {
        s: speciesId(m.species),
        lv: m.level,
        m: custom ? m.moves!.filter((x) => x && x !== "MOVE_NONE").map(moveSlug) : defaultMoves(m.level, learnsetOf(m.species, m.form)),
        ...(custom ? {} : { d: 1 as const }),
        ...(m.item && m.item !== "ITEM_NONE" ? { i: itemRef(m.item) } : {}),
        ...(m.form ? { f: m.form } : {}),
      };
    });
    const cls = className(t.class);
    const isRival = /^TRAINER_RIVAL_/.test(id);
    out.push({
      id: id.replace(/^TRAINER_/, ""),
      clsConst: t.class,
      cls: isRival ? "Rival" : cls,
      // The rival's name is chosen by the player; the data keeps a placeholder.
      ...(t.name && !isRival ? { name: titleName(t.name) } : {}),
      places,
      tag,
      group: id.replace(/^TRAINER_/, "").replace(/_REMATCH(_\d+)?$/, "").replace(/_(TURTWIG|CHIMCHAR|PIPLUP)$/, ""),
      double: t.double_battle,
      items: t.items.filter((i) => i && i !== "ITEM_NONE").map((i) => itemRef(i)),
      team,
    });
  }
  return out;
}
