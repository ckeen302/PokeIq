/**
 * Diamond & Pearl (pret/pokediamond).
 *
 *   files/poketool/trainer/trdata.json          – class, name, items, double battle, party (species, level, item, moves)
 *   include/constants/trainers.h                – trainer ids
 *   include/constants/trainer_classes.h         – class constants; printed names in files/msgdata/msg/narc_0560.gmm
 *   files/poketool/personal/wotbl.json          – level-up learnsets
 *   arm9/src/map_header.c                       – map -> scripts file, events file, map section
 *   files/msgdata/msg/narc_0382.gmm             – map section (location) names
 *   files/fielddata/eventdata/zone_event_release – object events; a trainer object runs script 3000 + id - 1
 *   files/fielddata/script/scr_seq_release      – compiled scripts; scripted battles are command 0x00E5
 *                                                 (TrainerBattle opponent1, opponent2) and 0x02A0 (tag battle)
 *
 * The map events and scripts are only available compiled, so places come from
 * reading those binaries: object events are a fixed-size table, and scripted
 * battles are found by their command bytes (see scriptedOpponents). Every
 * find is checked against the trainer table (a real party, not a partner
 * class); see docs/trainers.md for the cross-check against Platinum and a
 * second source.
 */
import fs from "node:fs";
import path from "node:path";
import { defaultMoves, itemRef, moveSlug, speciesId, titleName, type Learnset } from "./common";
import { headerSection } from "./platinum";
import type { RawPlace, RawTeam } from "./model";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");

interface DpMon {
  level: number;
  species: string;
  item?: string;
  moves?: string[];
}
interface DpTrainer {
  index: number;
  class: string;
  name: string;
  items: string[];
  doubleBattle: number;
  party: DpMon[];
}

/** Partner classes (they fight beside the player) and the Battle Tower's Tycoon. */
const PARTNER = /^TRAINER_CLASS_(PKMN_TRAINER_(CHERYL|RILEY|MARLEY|BUCK|MIRA|LUCAS|DAWN)|TOWER_TYCOON)$/;
/** The rival's starter -> the one the player chose. */
const RIVAL_TAG: Record<string, string> = { TURTWIG: "If you chose Chimchar", CHIMCHAR: "If you chose Piplup", PIPLUP: "If you chose Turtwig" };
const STARTER_LINES: Record<string, string> = { TURTWIG: "TURTWIG", GROTLE: "TURTWIG", TORTERRA: "TURTWIG", CHIMCHAR: "CHIMCHAR", MONFERNO: "CHIMCHAR", INFERNAPE: "CHIMCHAR", PIPLUP: "PIPLUP", PRINPLUP: "PIPLUP", EMPOLEON: "PIPLUP" };

const gmmText = (text: string) => [...text.matchAll(/<language name="English">([\s\S]*?)<\/language>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/₧₦/g, "Pokémon"));

/** Object events: [script id] for each object on the map. */
function objectScripts(buf: Buffer): number[] {
  const nBg = buf.readUInt32LE(0);
  let o = 4 + nBg * 20;
  const nObj = buf.readUInt32LE(o);
  o += 4;
  const out: number[] = [];
  for (let i = 0; i < nObj; i++) out.push(buf.readUInt16LE(o + i * 32 + 10));
  return out;
}

/**
 * Opponent trainer ids of the scripted battles in a compiled script file:
 * command 0x00E5 (opponent 1, opponent 2) or 0x02A0 (partner, opponent 1,
 * opponent 2) with literal trainer ids, immediately followed by the battle
 * result check (0x00EC) or a jump to it (0x0016). Requiring that next
 * command keeps stray byte matches out (the compiled files have no symbols).
 */
export function scriptedOpponents(buf: Buffer, isTrainer: (id: number) => boolean): { ids: number[]; vars: number } {
  const ids: number[] = [];
  let vars = 0;
  for (let i = 0; i + 8 <= buf.length; i++) {
    const op = buf.readUInt16LE(i);
    if (op !== 0xe5 && op !== 0x2a0) continue;
    const argStart = op === 0xe5 ? i + 2 : i + 4;
    const end = argStart + 4;
    if (end + 2 > buf.length) continue;
    const next = buf.readUInt16LE(end);
    if (next !== 0xec && next !== 0x16) continue;
    const args = [buf.readUInt16LE(argStart), buf.readUInt16LE(argStart + 2)];
    if (args.some((a) => a !== 0 && a < 0x4000 && !isTrainer(a))) continue;
    for (const a of args) {
      if (a >= 0x4000) vars++;
      else if (a) ids.push(a);
    }
  }
  return { ids, vars };
}

export function importDiamondPearl(root: string): RawTeam[] {
  const consts = new Map<number, string>();
  for (const m of read(root, "include/constants/trainers.h").matchAll(/#define\s+(TRAINER_\w+)\s+(\d+)/g)) consts.set(Number(m[2]), m[1]);
  const classNum = new Map<string, number>();
  for (const m of read(root, "include/constants/trainer_classes.h").matchAll(/#define\s+(TRAINER_CLASS_\w+)\s+(\d+)/g)) classNum.set(m[1], Number(m[2]));
  const classText = gmmText(read(root, "files/msgdata/msg/narc_0560.gmm"));
  const locText = gmmText(read(root, "files/msgdata/msg/narc_0382.gmm"));
  const mapsec = new Map<string, number>();
  for (const m of read(root, "include/constants/map_sections.h").matchAll(/#define\s+(MAPSEC_\w+)\s+(\d+)/g)) mapsec.set(m[1], Number(m[2]));
  const trainers = (JSON.parse(read(root, "files/poketool/trainer/trdata.json")).trdata as DpTrainer[]).filter((t) => t.index > 0);
  const byIndex = new Map(trainers.map((t) => [t.index, t]));
  const isTrainer = (id: number) => {
    const t = byIndex.get(id);
    return !!t && t.party.length > 0 && !PARTNER.test(t.class);
  };

  const spots = new Map<number, RawPlace[]>();
  const add = (id: number, p: RawPlace) => {
    const l = spots.get(id) ?? [];
    if (!l.some((x) => x.area === p.area && x.section === p.section)) l.push(p);
    spots.set(id, l);
  };
  const scrDir = path.join(root, "files/fielddata/script/scr_seq_release");
  const evDir = path.join(root, "files/fielddata/eventdata/zone_event_release");
  for (const line of read(root, "arm9/src/map_header.c").split("\n")) {
    // Fields: area data, models, matrix, scripts, level scripts, messages, music ×2, encounters, events, map section, …
    const m = /^\s*\{ [^,]+, [^,]+, [^,]+, NARC_scr_seq_release_narc_(\d+)_bin, .*?NARC_zone_event_release_narc_(\d+)_bin, (MAPSEC_\w+),.*\/\/ (MAP_\w+)/.exec(line);
    if (!m) continue;
    const [, scr, ev, sec, rawMap] = m;
    const map = rawMap
      .replace(/JUBLIFE/g, "JUBILIFE")
      .replace(/^MAP_JUBILIFE_TRAINER_SCHOOL/, "MAP_TRAINERS_SCHOOL")
      .replace(/VEILSTONE_GALACTIC_HEADQUARTERS/, "GALACTIC_HQ")
      .replace(/_4F_(1|BACK)$/, "_4F")
      .replace(/CYNTHIA_ROOM/, "CHAMPION_ROOM")
      .replace(/GYM_\w+_QUESTION_TRAINER_ROOM_\d$/, "GYM_TRAINER_ROOM");
    const area = locText[mapsec.get(sec) ?? -1];
    if (!area || area === "Mystery Zone") continue;
    if (/BATTLE_TOWER|UNION|COLOSSEUM|UNDERGROUND|_UNUSED/.test(map)) continue;
    // "MAP_OREBURGH_GYM" in Oreburgh City reads as "Gym".
    const first = area.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    const header = /^(.+) (CITY|TOWN)$/.test(area.toUpperCase()) ? map.replace(new RegExp(`^MAP_${first}(?!_(CITY|TOWN))`), `MAP_${area.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`) : map;
    const place: RawPlace = { area, region: "Sinnoh", section: headerSection(area, header) };
    for (const s of objectScripts(fs.readFileSync(path.join(evDir, `narc_${ev.padStart(4, "0")}.bin`)))) {
      if (s >= 3000 && s < 5000 && isTrainer(s - 2999)) add(s - 2999, place);
      // The second trainer of a two-person double battle.
      else if (s >= 5000 && s < 7000 && isTrainer(s - 4999)) add(s - 4999, place);
    }
    const found = scriptedOpponents(fs.readFileSync(path.join(scrDir, `narc_${scr.padStart(4, "0")}.bin`)), isTrainer);
    for (const id of found.ids) add(id, place);
    if (found.vars && process.env.DEBUG) console.warn(`${map}: ${found.vars} battle(s) with a variable opponent`);
  }

  const learnsets = new Map<string, Learnset>();
  for (const w of JSON.parse(read(root, "files/poketool/personal/wotbl.json")).wotbl as { species: string; moves: { move: string; level: number }[] }[])
    if (w.species !== "NONE" && !learnsets.has(w.species)) learnsets.set(w.species, w.moves.map((x) => ({ level: x.level, move: moveSlug(`MOVE_${x.move}`) })));

  const out: RawTeam[] = [];
  for (const t of trainers) {
    const places = spots.get(t.index);
    if (!places?.length) continue;
    const cls = classText[classNum.get(t.class)!] ?? t.class;
    const isRival = t.class === "TRAINER_CLASS_PKMN_TRAINER_BARRY";
    const team = t.party.map((p) => {
      const custom = Array.isArray(p.moves);
      const sp = p.species.replace(/^SPECIES_/, "");
      return {
        s: speciesId(p.species),
        lv: p.level,
        m: custom ? p.moves!.filter((x) => x && x !== "MOVE_NONE").map(moveSlug) : defaultMoves(p.level, learnsets.get(sp) ?? []),
        ...(custom ? {} : { d: 1 as const }),
        ...(p.item && p.item !== "ITEM_NONE" ? { i: itemRef(p.item) } : {}),
      };
    });
    const id = (consts.get(t.index) ?? `TRAINER_${t.index}`).replace(/^TRAINER_/, "");
    let tag: string | undefined;
    let group: string | undefined;
    if (isRival) {
      const starter = t.party.map((p) => STARTER_LINES[p.species.replace(/^SPECIES_/, "")]).find(Boolean);
      tag = starter ? RIVAL_TAG[starter] : undefined;
      group = `RIVAL_${places.map((p) => `${p.area}|${p.section ?? ""}`).sort().join("+")}_${Math.max(...t.party.map((p) => p.level))}`.replace(/[^A-Za-z0-9|+_]/g, "");
    }
    const name = t.name.replace(/^\{TRNAME\}/, "").trim();
    out.push({
      id,
      clsConst: t.class,
      cls: isRival ? "Rival" : cls,
      // The rival's name is chosen by the player; the data keeps a placeholder.
      ...(name && !isRival ? { name: titleName(name) } : {}),
      places,
      tag,
      group,
      double: !!t.doubleBattle,
      items: t.items.filter((i) => i && i !== "ITEM_NONE").map((i) => itemRef(i)),
      team,
    });
  }
  return out;
}
