/**
 * HeartGold / SoulSilver (pret/pokeheartgold).
 *
 *   files/poketool/trainer/trainers.json – every trainer by id (class, name, items, party)
 *   include/constants/trainers.h         – trainer id constants
 *   include/constants/trainer_class.h + files/msgdata/msg/msg_0730.json – class names
 *   files/poketool/personal/wotbl.narc   – level-up learnsets (binary NARC: u16 (level << 9) | move, 0xFFFF end)
 *   src/data/map_headers.h               – map -> scripts, events, mapsec
 *   files/fielddata/eventdata/zone_event/*.json – std_trainer(TRAINER_X) objects
 *   files/fielddata/script/scr_seq/*.s   – TrainerBattle / MultiBattle
 *   include/constants/map_sections.h + files/msgdata/msg/msg_0279.json – location names
 */
import fs from "node:fs";
import path from "node:path";
import movesData from "../../src/data/moves.json";
import { defaultMoves, itemRef, moveSlug, speciesId, titleName, type Learnset } from "./common";
import { parseHeaders, headerSection } from "./platinum";
import type { RawPlace, RawTeam } from "./model";
import { slugify } from "../../src/lib/dex/build";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");

/** Files inside a Nitro archive. */
export function readNarc(buf: Buffer): Buffer[] {
  if (buf.toString("ascii", 0, 4) !== "NARC") throw new Error("Not a NARC");
  const headerSize = buf.readUInt16LE(12);
  let off = headerSize;
  const fatb = off;
  if (buf.toString("ascii", fatb, fatb + 4) !== "BTAF") throw new Error("No BTAF");
  const fatbSize = buf.readUInt32LE(fatb + 4);
  const count = buf.readUInt16LE(fatb + 8);
  off = fatb + fatbSize;
  if (buf.toString("ascii", off, off + 4) !== "BTNF") throw new Error("No BTNF");
  off += buf.readUInt32LE(off + 4);
  if (buf.toString("ascii", off, off + 4) !== "GMIF") throw new Error("No GMIF");
  const data = off + 8;
  const files: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const s = buf.readUInt32LE(fatb + 12 + i * 8);
    const e = buf.readUInt32LE(fatb + 16 + i * 8);
    files.push(buf.subarray(data + s, data + e));
  }
  return files;
}

// Gen IV move ids are the national move ids PokéAPI (and our moves.json) use.
const MOVE_BY_ID = new Map<number, string>();
{
  const used = new Set<string>();
  for (const [id, m] of Object.entries(movesData as Record<string, { name: string }>).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    let slug = slugify(m.name);
    if (used.has(slug)) slug = `${slug}-${id}`;
    used.add(slug);
    MOVE_BY_ID.set(Number(id), slug);
  }
}

export function parseWotbl(buf: Buffer): Learnset[] {
  return readNarc(buf).map((f) => {
    const out: Learnset = [];
    for (let i = 0; i + 1 < f.length; i += 2) {
      const v = f.readUInt16LE(i);
      if (v === 0xffff) break;
      const move = v & 0x1ff;
      const slug = MOVE_BY_ID.get(move);
      if (!slug) throw new Error(`Unknown move id ${move}`);
      out.push({ level: v >> 9, move: slug });
    }
    return out;
  });
}

interface HgMon {
  level: number;
  species: string;
  item?: string;
  moves?: string[];
}
interface HgTrainer {
  type: string;
  class: string;
  name: string;
  items: string[];
  double: number;
  party: HgMon[];
}

const PARTNER = /^TRAINER_PARTNER_|^TRAINER_PKMN_TRAINER_LANCE_LANCE$/;
const RIVAL_FAMILIES: [string[], string][] = [
  [["SPECIES_CHIKORITA", "SPECIES_BAYLEEF", "SPECIES_MEGANIUM"], "If you chose Totodile"],
  [["SPECIES_CYNDAQUIL", "SPECIES_QUILAVA", "SPECIES_TYPHLOSION"], "If you chose Chikorita"],
  [["SPECIES_TOTODILE", "SPECIES_CROCONAW", "SPECIES_FERALIGATR"], "If you chose Cyndaquil"],
];
/** Kanto places in the Johto games (Gen II landmarks); everything else is Johto. */
const KANTO = /^(Route ([1-9]|1\d|2[0-8])$|Pallet Town|Viridian City|Viridian Forest|Pewter City|Cerulean City|Cerulean Cave|Vermilion City|Lavender Town|Celadon City|Saffron City|Fuchsia City|Cinnabar Island|Indigo Plateau|Victory Road|Mt\. Moon|Rock Tunnel|Silph Co\.|Safari Zone Gate|Seafoam Islands|Pokémon Mansion|Diglett’s Cave|Diglett's Cave|Tohjo Falls|Mt\. Silver|S\.S\. Aqua|Power Plant|Underground Path|Lavender Radio Tower|Pokémon League|Viridian Gym|Kanto Power Plant|Mt\. Silver Cave|Pokémon Tower|Celadon Dept\. Store|Saffron Gym|Magnet Train)/;

export function importHgss(root: string): RawTeam[] {
  const trainers = (JSON.parse(read(root, "files/poketool/trainer/trainers.json")) as { trainers: HgTrainer[] }).trainers;
  const ids = new Map<number, string>();
  for (const m of read(root, "include/constants/trainers.h").matchAll(/#define\s+(TRAINER_\w+)\s+(\d+)/g)) if (!/^(FIRST_|TRAINER_NONE$)/.test(m[1]) && !ids.has(Number(m[2]))) ids.set(Number(m[2]), m[1]);
  const classIdx = new Map([...read(root, "include/constants/trainer_class.h").matchAll(/#define\s+(TRAINERCLASS_\w+)\s+(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const classText = (JSON.parse(read(root, "files/msgdata/msg/msg_0730.json")).messages as { en_US: string }[]).map((m) => m.en_US);
  const learnsets = parseWotbl(fs.readFileSync(path.join(root, "files/poketool/personal/wotbl.narc")));

  const mapsec = new Map([...read(root, "include/constants/map_sections.h").matchAll(/#define\s+(MAPSEC_\w+)\s+(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const locText = (JSON.parse(read(root, "files/msgdata/msg/msg_0279.json")).messages as { en_US: string }[]).map((m) => m.en_US);
  const headers = parseHeaders(read(root, "src/data/map_headers.h"));
  const spots = new Map<string, RawPlace[]>();
  const add = (id: string, p: RawPlace) => {
    const l = spots.get(id) ?? [];
    if (!l.some((x) => x.area === p.area && x.section === p.section)) l.push(p);
    spots.set(id, l);
  };
  const scrDir = path.join(root, "files/fielddata/script/scr_seq");
  const evDir = path.join(root, "files/fielddata/eventdata/zone_event");
  for (const [name, h] of headers) {
    const sec = mapsec.get(h.mapsec ?? "");
    // msg_0279 shouts some names ("SLOWPOKE Well").
    const area = sec !== undefined ? locText[sec]?.replace(/\b[A-Z]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase()) : undefined;
    if (!area || area === "Mystery Zone") continue;
    if (/BATTLE_(TOWER|FACTORY|HALL|CASTLE|ARCADE)|FRONTIER|UNION|COLOSSEUM|WIFI/.test(name)) continue;
    const place: RawPlace = { area, region: KANTO.test(area) ? "Kanto" : "Johto", section: headerSection(area, name) };
    const ev = /NARC_zone_event_(\w+)_bin/.exec(h.eventsBank ?? "")?.[1];
    if (ev && fs.existsSync(path.join(evDir, `${ev}.json`))) for (const m of fs.readFileSync(path.join(evDir, `${ev}.json`), "utf8").matchAll(/std_trainer\w*\((TRAINER_\w+)\)/g)) add(m[1], place);
    const sc = /^(scr_seq_\w+)_bin$/.exec(h.scriptsBank ?? "")?.[1];
    if (sc && fs.existsSync(path.join(scrDir, `${sc}.s`))) {
      for (const line of fs.readFileSync(path.join(scrDir, `${sc}.s`), "utf8").split("\n")) {
        const l = line.trim();
        const cmd = l.split(/\s+/)[0];
        if (cmd === "TrainerBattle") for (const id of l.split(",")[0].match(/\bTRAINER_\w+/g) ?? []) add(id, place);
        if (cmd === "TrainerBattle") for (const id of (l.split(",")[1] ?? "").match(/\bTRAINER_\w+/g) ?? []) add(id, place);
        if (cmd === "MultiBattle") for (const id of l.split(",").slice(1, 3).join(",").match(/\bTRAINER_\w+/g) ?? []) add(id, place);
      }
    }
  }

  const learnsetFor = (dex: number) => {
    const ls = learnsets[dex];
    if (!ls?.length) throw new Error(`No HGSS learnset for #${dex}`);
    return ls;
  };
  const out: RawTeam[] = [];
  trainers.forEach((t, idx) => {
    const id = ids.get(idx);
    if (!id || PARTNER.test(id) || !t.party.length) return;
    let places = spots.get(id) ?? [];
    let tag: string | undefined;
    const rm = /^(TRAINER_\w+?)_(\d+)$/.exec(id);
    // Phone rematches (_2, _3 …) are loaded by the shared phone script: same spot as the first battle.
    if (rm && !/RIVAL|GRUNT|EXECUTIVE|ROCKET|LEADER|CHAMPION|ELITE|PKMN_TRAINER|BOSS/.test(id)) {
      if (!places.length) places = spots.get(rm[1]) ?? [];
      if (spots.get(rm[1])) tag = `Rematch ${Number(rm[2]) - 1}`;
    }
    if (/^TRAINER_(LEADER|ELITE_FOUR)_\w+_2$/.test(id)) tag = "Rematch";
    if (!places.length) return;
    const cls = (classText[classIdx.get(t.class) ?? -1] ?? t.class).replace(/₧₦/g, "Pokémon");
    const isRival = t.class === "TRAINERCLASS_RIVAL";
    if (isRival) for (const [fam, label] of RIVAL_FAMILIES) if (t.party.some((m) => fam.includes(m.species))) tag = label;
    const hasMoves = /MOVES/.test(t.type);
    const hasItem = /ITEM/.test(t.type);
    const team = t.party.map((m) => {
      const dex = speciesId(m.species);
      const custom = hasMoves && Array.isArray(m.moves);
      return {
        s: dex,
        lv: m.level,
        m: custom ? m.moves!.filter((x) => x && x !== "MOVE_NONE").map(moveSlug) : defaultMoves(m.level, learnsetFor(dex)),
        ...(custom ? {} : { d: 1 as const }),
        ...(hasItem && m.item && m.item !== "ITEM_NONE" ? { i: itemRef(m.item) } : {}),
      };
    });
    const name = t.name.replace(/\{[^}]*\}/g, "").trim();
    out.push({
      id: id.replace(/^TRAINER_/, ""),
      clsConst: t.class,
      cls,
      ...(name && !isRival && name !== "-" ? { name: titleName(name) } : {}),
      places,
      tag,
      // Rival starter variants are separate ids fought in one spot: group them by place.
      group: isRival ? `RIVAL@${places.map((p) => `${p.area}/${p.section ?? ""}`).join("|")}` : rm && tag?.startsWith("Rematch") ? rm[1].replace(/^TRAINER_/, "") : id.replace(/^TRAINER_/, ""),
      double: Boolean(t.double),
      items: t.items.filter((i) => i && i !== "ITEM_NONE").map((i) => itemRef(i)),
      team,
    });
  });
  return out;
}
