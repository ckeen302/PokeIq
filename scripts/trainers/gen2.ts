/**
 * Gen II (pret/pokegold, pret/pokecrystal).
 *
 *   data/trainers/parties.asm        – "NAME@", TRAINERTYPE_* and the party per trainer constant
 *   data/trainers/party_pointers.asm – group label per class
 *   data/trainers/class_names.asm    – printed class names
 *   constants/trainer_constants.asm  – trainerclass / const (party index inside a class)
 *   data/pokemon/evos_attacks*.asm   – level-up learnsets (FillMoves for TRAINERTYPE_NORMAL/ITEM)
 *   maps/*.asm                       – `trainer CLASS, ID` (map trainers) and `loadtrainer CLASS, ID` (scripted battles, rematches)
 *   data/maps/maps.asm + landmarks   – map -> landmark (the town-map name) and its region
 */
import fs from "node:fs";
import path from "node:path";
import { defaultMoves, itemRef, moveSlug, operands, parseNum, speciesId, stripAsm, titleName, type Learnset } from "./common";
import type { RawPlace, RawTeam } from "./model";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");

export interface Gen2Party {
  group: string;
  /** 1-based index inside the class. */
  no: number;
  name: string;
  type: string;
  mons: { level: number; species: string; item?: string; moves?: string[] }[];
}

export function parseGen2Parties(text: string): Gen2Party[] {
  const out: Gen2Party[] = [];
  let group = "";
  let no = 0;
  let cur: Gen2Party | null = null;
  for (const raw of text.split("\n")) {
    const lab = /^(\w+Group):/.exec(raw);
    if (lab) {
      group = lab[1];
      no = 0;
      continue;
    }
    const body = stripAsm(raw);
    if (!body.startsWith("db ")) continue;
    const name = /^db\s+"([^"]*)",\s*(TRAINERTYPE_\w+)/.exec(body);
    if (name) {
      no++;
      cur = { group, no, name: name[1].replace(/@$/, ""), type: name[2], mons: [] };
      out.push(cur);
      continue;
    }
    const ops = operands(body.slice(3));
    if (ops.length === 1 && ops[0] === "-1") {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const [lv, sp, ...rest] = ops;
    const mon: Gen2Party["mons"][number] = { level: parseNum(lv), species: sp };
    if (cur.type === "TRAINERTYPE_ITEM" || cur.type === "TRAINERTYPE_ITEM_MOVES") mon.item = rest.shift();
    if (cur.type === "TRAINERTYPE_MOVES" || cur.type === "TRAINERTYPE_ITEM_MOVES") mon.moves = rest.filter((m) => m !== "NO_MOVE");
    cur.mons.push(mon);
  }
  return out;
}

/** trainerclass X / const Y -> { class index, constant -> party index }. */
export function parseGen2Constants(text: string): { classes: string[]; partyNo: Map<string, number> } {
  const classes: string[] = [];
  const partyNo = new Map<string, number>();
  let n = 0;
  let cls = "";
  for (const raw of text.split("\n")) {
    const body = stripAsm(raw);
    const tc = /^trainerclass\s+(\w+)/.exec(body);
    if (tc) {
      cls = tc[1];
      classes.push(cls);
      n = 0;
      continue;
    }
    const c = /^const\s+(\w+)/.exec(body);
    if (c && cls) {
      n++;
      partyNo.set(`${cls}:${c[1]}`, n);
    }
  }
  return { classes, partyNo };
}

/** Learnsets in pointer-table order. */
export function parseGen2Learnsets(evos: string, pointers: string): Learnset[] {
  const order = [...pointers.matchAll(/dw\s+(\w+EvosAttacks)/g)].map((m) => m[1]);
  const sets = new Map<string, Learnset>();
  let cur: Learnset | null = null;
  let phase = 0;
  for (const raw of evos.split("\n")) {
    const lab = /^(\w+EvosAttacks):/.exec(raw);
    if (lab) {
      cur = [];
      sets.set(lab[1], cur);
      phase = 0;
      continue;
    }
    if (!cur) continue;
    const body = stripAsm(raw);
    if (!body.startsWith("db ")) continue;
    const ops = operands(body.slice(3));
    const end = ops.length === 1 && ops[0] === "0";
    if (phase === 0) {
      if (end) phase = 1;
      continue;
    }
    if (phase === 1) {
      if (end) {
        phase = 2;
        continue;
      }
      cur.push({ level: parseNum(ops[0]), move: moveSlug(ops[1]) });
    }
  }
  return order.map((l) => {
    const s = sets.get(l);
    if (!s) throw new Error(`No learnset ${l}`);
    return s;
  });
}

const LANDMARK_NAMES: Record<string, string> = { "MT.MORTAR": "Mt. Mortar", "MT.MOON": "Mt. Moon", "LAV RADIO TOWER": "Lavender Radio Tower", "#MON MANSION": "Pokémon Mansion", "SILVER CAVE": "Mt. Silver", UNDERGROUND: "Underground Path", "S.S.AQUA": "S.S. Aqua", LIGHTHOUSE: "Olivine Lighthouse" };

export function landmarkTitle(raw: string): string {
  const s = raw.replace(/<BSP>/g, " ").replace(/@$/, "").replace(/\s+/g, " ").trim();
  return LANDMARK_NAMES[s] ?? titleName(s.replace(/#MON/g, "POKéMON"));
}

/** Map label -> its landmark name and region. */
function mapLandmarks(root: string): Map<string, { area: string; region: string }> {
  const consts = [...read(root, "constants/landmark_constants.asm").matchAll(/^\s*(const\s+(\w+)|DEF KANTO_LANDMARK EQU)/gm)];
  const order: string[] = [];
  let kantoFrom = Infinity;
  for (const m of consts) {
    if (m[1].startsWith("DEF")) kantoFrom = order.length;
    else if (m[2] !== "const_def") order.push(m[2]);
  }
  const lm = read(root, "data/maps/landmarks.asm");
  const labels = [...lm.matchAll(/^\s*landmark\s+[-\d]+,\s*[-\d]+,\s*(\w+)/gm)].map((m) => m[1]);
  const strings = new Map([...lm.matchAll(/^(\w+):\s*db\s+"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  const byConst = new Map<string, { area: string; region: string }>();
  order.forEach((c, i) => {
    const s = strings.get(labels[i]);
    if (s && c !== "LANDMARK_SPECIAL") byConst.set(c, { area: landmarkTitle(s), region: i >= kantoFrom ? "Kanto" : "Johto" });
  });
  const out = new Map<string, { area: string; region: string }>();
  for (const m of read(root, "data/maps/maps.asm").matchAll(/^\s*map\s+(\w+),\s*\w+,\s*\w+,\s*(LANDMARK_\w+)/gm)) {
    const l = byConst.get(m[2]);
    if (l) out.set(m[1], l);
  }
  return out;
}

const spaced = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/(\d)([A-Z][a-z])/g, "$1 $2").replace(/(\dF)([A-Z])/g, "$1 $2");

/** "Sprout Tower 3F" inside "Sprout Tower" -> "3F"; "Violet Gym" inside "Violet City" stays. */
export function sectionFor(area: string, mapLabel: string): string | undefined {
  const sec = spaced(mapLabel);
  const a = area.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ");
  const w = sec.split(" ");
  let i = 0;
  while (i < a.length && i < w.length && w[i].toLowerCase().replace(/[^a-z0-9]/g, "") === a[i]) i++;
  if (i === a.length) return tidySection(w.slice(i).join(" ")) || undefined;
  if (/^mount$/i.test(w[0]) && a[0] === "mt") return sectionFor(area, mapLabel.replace(/^Mount/, "Mt"));
  return tidySection(sec);
}
const tidySection = (s: string) =>
  s
    .replace(/_/g, " ")
    .replace(/\b(\w+)s Room\b/g, "$1's Room")
    .replace(/\bPokecenter\b/g, "Pokémon Center")
    .replace(/\bPokemon\b/g, "Pokémon")
    .trim();

const RIVAL_TAG: Record<string, string> = { CHIKORITA: "If you chose Totodile", CYNDAQUIL: "If you chose Chikorita", TOTODILE: "If you chose Cyndaquil" };

export function importGen2(root: string, game: "gold-silver" | "crystal"): RawTeam[] {
  const parties = parseGen2Parties(read(root, "data/trainers/parties.asm"));
  const { classes, partyNo } = parseGen2Constants(read(root, "constants/trainer_constants.asm"));
  const groups = [...read(root, "data/trainers/party_pointers.asm").matchAll(/dw\s+(\w+Group)/g)].map((m) => m[1]);
  const classNames = [...read(root, "data/trainers/class_names.asm").matchAll(/^\s*li\s+"([^"]*)"/gm)].map((m) => m[1]);
  const pointersFile = fs.existsSync(path.join(root, "data/pokemon/evos_attacks_pointers.asm")) ? "data/pokemon/evos_attacks_pointers.asm" : "data/pokemon/evos_attacks.asm";
  const learnsets = parseGen2Learnsets(read(root, "data/pokemon/evos_attacks.asm"), read(root, pointersFile));
  const dexOrder = [...read(root, "constants/pokemon_constants.asm").matchAll(/^\s*const\s+(\w+)/gm)].map((m) => m[1]).filter((s) => s !== "NO_MONSTER" && s !== "NO_MON");
  const learnsetOf = new Map<string, Learnset>();
  dexOrder.slice(0, learnsets.length).forEach((s, i) => learnsetOf.set(s, learnsets[i]));
  const landmarks = mapLandmarks(root);

  // Where each (class, party index) is battled.
  const spots = new Map<string, RawPlace[]>();
  const reverse = new Map<number, string>();
  for (const [k, v] of partyNo) reverse.set(v, k);
  const mapsDir = path.join(root, "maps");
  for (const f of fs.readdirSync(mapsDir).filter((x) => x.endsWith(".asm"))) {
    const label = f.replace(/\.asm$/, "");
    const lm = landmarks.get(label);
    if (!lm) continue;
    const text = fs.readFileSync(path.join(mapsDir, f), "utf8");
    for (const m of text.matchAll(/^\s*(?:trainer|loadtrainer)\s+(\w+),\s*(\w+)/gm)) {
      const no = partyNo.get(`${m[1]}:${m[2]}`);
      if (!no) continue;
      const key = `${m[1]}:${no}`;
      const place: RawPlace = { area: lm.area, region: lm.region, section: sectionFor(lm.area, label) };
      const list = spots.get(key) ?? [];
      if (!list.some((p) => p.area === place.area && p.section === place.section)) list.push(place);
      spots.set(key, list);
    }
  }

  const constName = new Map<string, string>();
  for (const [k, v] of partyNo) constName.set(`${k.split(":")[0]}:${v}`, k.split(":")[1]);

  const out: RawTeam[] = [];
  for (const p of parties) {
    const ci = groups.indexOf(p.group);
    if (ci < 0) throw new Error(`Unknown group ${p.group}`);
    const cls = classes[ci + 1];
    if (!cls) throw new Error(`No class for ${p.group}`);
    const cname = constName.get(`${cls}:${p.no}`) ?? `${cls}_${p.no}`;
    const places = spots.get(`${cls}:${p.no}`) ?? [];
    // Parties no map script loads are unused leftovers in the ROM.
    if (!places.length) continue;
    const team = p.mons.map((m) => {
      const ls = learnsetOf.get(m.species);
      if (!ls) throw new Error(`No learnset for ${m.species}`);
      const custom = m.moves !== undefined;
      return {
        s: speciesId(m.species),
        lv: m.level,
        m: custom ? m.moves!.map(moveSlug) : defaultMoves(m.level, ls),
        ...(custom ? {} : { d: 1 as const }),
        ...(m.item && m.item !== "NO_ITEM" ? { i: itemRef(m.item) } : {}),
      };
    });
    let tag: string | undefined;
    const rematch = /^([A-Z]+)(\d)$/.exec(cname);
    if (/^RIVAL/.test(cls)) {
      const starter = /_(CHIKORITA|CYNDAQUIL|TOTODILE)$/.exec(cname)?.[1];
      if (starter) tag = RIVAL_TAG[starter];
    } else if (rematch && Number(rematch[2]) > 1 && partyNo.has(`${cls}:${rematch[1]}1`)) {
      tag = `Rematch ${Number(rematch[2]) - 1}`;
    }
    const printed = classNames[ci];
    out.push({
      id: `${cls}-${cname}`,
      clsConst: cls,
      cls: gen2ClassName(printed, cls),
      ...(p.name && p.name !== "?" ? { name: titleName(p.name) } : {}),
      places,
      tag,
      group: `${cls}-${cname.replace(/_(CHIKORITA|CYNDAQUIL|TOTODILE)$/, "").replace(/^([A-Z]+)\d$/, "$1")}`,
      team,
    });
  }
  void game;
  return out;
}

function gen2ClassName(printed: string, cls: string): string {
  if (/^RIVAL\d$/.test(cls)) return "Rival";
  const p = printed.replace(/<PKMN>/g, "PKMN").replace(/#MON/g, "POKéMON").replace(/#/g, "POKé");
  const fixed: Record<string, string> = { "POKéMON PROF.": "Pokémon Prof.", "PKMN TRAINER": "Pokémon Trainer" };
  return fixed[p] ?? titleName(p);
}
