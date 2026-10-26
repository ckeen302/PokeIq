/**
 * Gen I (pret/pokered, pret/pokeyellow): trainer parties, the moves the
 * engine writes over the default moveset, and where each party is fought.
 *
 *   data/trainers/parties.asm      – parties per class (level-for-all or $FF per-Pokémon levels)
 *   data/trainers/names.asm        – class names
 *   data/trainers/special_moves.asm – RB: LoneMoves/TeamMoves; Yellow: SpecialTrainerMoves
 *   data/pokemon/base_stats/*.asm  – "level 1 learnset" (base moves)
 *   data/pokemon/evos_moves.asm    – level-up learnsets
 *   data/maps/objects/*.asm        – object_event … OPP_CLASS, N  (who stands where)
 *   scripts/*Gym.asm               – wGymLeaderNo (picks the LoneMoves entry)
 */
import fs from "node:fs";
import path from "node:path";
import { defaultMoves, moveSlug, operands, parseNum, speciesId, stripAsm, titleName, type Learnset } from "./common";
import type { RawTeam } from "./model";

const read = (root: string, f: string) => fs.readFileSync(path.join(root, f), "utf8");

export interface Gen1Party {
  cls: number;
  /** 1-based index inside the class (wTrainerNo). */
  no: number;
  mons: { species: string; level: number }[];
  special: boolean;
  /** The `; Route 3` comment heading the block the party sits in. */
  comment?: string;
  /** Index of the comment block inside the class. */
  block: number;
  /** A trailing `; Mt. Moon B2F` comment on the party line itself. */
  inline?: string;
}

/** Parse parties.asm into parties per class (1-based class ids, as OPP_ offsets). */
export function parseGen1Parties(text: string): { classLabels: string[]; parties: Gen1Party[] } {
  const lines = text.split("\n");
  const classLabels: string[] = [];
  for (const l of lines) {
    const m = /^\s*dw\s+(\w+Data)\s*$/.exec(l);
    if (m) classLabels.push(m[1]);
  }
  const parties: Gen1Party[] = [];
  let cls = 0;
  let no = 0;
  let comment: string | undefined;
  let block = 0;
  for (const raw of lines) {
    const label = /^(\w+Data):/.exec(raw);
    if (label) {
      cls = classLabels.indexOf(label[1]) + 1;
      if (!cls) throw new Error(`Unknown party label ${label[1]}`);
      no = 0;
      comment = undefined;
      block = 0;
      continue;
    }
    if (!cls) continue;
    const c = /^;\s*(.+?)\s*$/.exec(raw.trim());
    if (c) {
      comment = c[1];
      block++;
      continue;
    }
    const body = stripAsm(raw);
    if (!body.startsWith("db ")) continue;
    const inline = /;\s*(.+?)\s*$/.exec(raw)?.[1];
    const ops = operands(body.slice(3));
    if (ops[ops.length - 1] !== "0") throw new Error(`Party not terminated: ${raw}`);
    ops.pop();
    no++;
    const mons: Gen1Party["mons"] = [];
    let special = false;
    if (ops[0] === "$FF") {
      special = true;
      for (let i = 1; i < ops.length; i += 2) mons.push({ level: parseNum(ops[i]), species: ops[i + 1] });
    } else {
      const level = parseNum(ops[0]);
      for (const s of ops.slice(1)) mons.push({ level, species: s });
    }
    parties.push({ cls, no, mons, special, comment, block, ...(inline ? { inline } : {}) });
  }
  return { classLabels, parties };
}

/** `li "BUG CATCHER"` list -> class names (1-based). */
export function parseGen1ClassNames(text: string): string[] {
  return [...text.matchAll(/^\s*li\s+"([^"]*)"/gm)].map((m) => m[1]);
}

/** trainer_const lines -> constant name per class id. */
export function parseGen1ClassConstants(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*trainer_const\s+(\w+)/gm)) out.push(m[1]);
  return out; // index 0 = NOBODY
}

/** object_event … OPP_CLASS, N lines per map. */
export function parseGen1Objects(text: string): { cls: string; no: number }[] {
  return [...text.matchAll(/object_event[^\n]*?\bOPP_(\w+),\s*(\d+)/g)].map((m) => ({ cls: m[1], no: Number(m[2]) }));
}

/** evos_moves.asm -> learnset per pointer-table label. */
export function parseGen1Learnsets(text: string): { order: string[]; sets: Map<string, Learnset> } {
  const order: string[] = [];
  const table = text.slice(text.indexOf("EvosMovesPointerTable:"), text.indexOf("assert_table_length"));
  for (const m of table.matchAll(/dw\s+(\w+)/g)) order.push(m[1]);
  const sets = new Map<string, Learnset>();
  let cur: string | null = null;
  let phase = 0;
  for (const raw of text.split("\n")) {
    const lab = /^(\w+EvosMoves):/.exec(raw);
    if (lab) {
      cur = lab[1];
      phase = 0;
      sets.set(cur, []);
      continue;
    }
    if (!cur) continue;
    const body = stripAsm(raw);
    if (!body.startsWith("db ")) continue;
    const ops = operands(body.slice(3));
    if (phase === 0) {
      if (ops.length === 1 && ops[0] === "0") phase = 1;
      continue;
    }
    if (phase === 1) {
      if (ops.length === 1 && ops[0] === "0") {
        phase = 2;
        continue;
      }
      sets.get(cur)!.push({ level: parseNum(ops[0]), move: moveSlug(ops[1]) });
    }
  }
  return { order, sets };
}

interface Gen1Out {
  teams: RawTeam[];
}

/** Gen I map label -> area + section. */
export function gen1Place(label: string): { area: string; section?: string } {
  const l = label.replace(/[\s.'’é]/g, (c) => (c === "é" ? "e" : "")).replace(/^Mansion/, "PokemonMansion");
  const rules: [RegExp, string, ((m: RegExpExecArray) => string | undefined)?][] = [
    [/^Route(\d+)(.*)$/, "", (m) => m[2] || undefined],
    [/^MtMoon(.*)$/, "Mt. Moon"],
    [/^SSAnne(.*)$/, "S.S. Anne"],
    [/^PokemonTower(.*)$/, "Pokémon Tower"],
    [/^PokemonMansion(.*)$/, "Pokémon Mansion"],
    [/^RocketHideout(.*)$/, "Rocket Hideout"],
    [/^SilphCo(.*)$/, "Silph Co."],
    [/^VictoryRoad(.*)$/, "Victory Road"],
    [/^RockTunnel(.*)$/, "Rock Tunnel"],
    [/^SeafoamIslands(.*)$/, "Seafoam Islands"],
    [/^(Loreleis|Brunos|Agathas|Lances|Champions)Room$/, "Indigo Plateau", (m) => `${m[1].replace(/s$/, "")}'s Room`],
    [/^GameCorner$/, "Celadon Game Corner"],
    [/^OaksLab$/, "Oak's Lab"],
  ];
  for (const [re, area, sec] of rules) {
    const m = re.exec(l);
    if (!m) continue;
    if (re.source.startsWith("^Route")) return { area: `Route ${m[1]}`, section: sec?.(m) ? spaced(sec(m)!) : undefined };
    const s = sec ? sec(m) : m[1];
    return { area, section: s ? spaced(s) : undefined };
  }
  return { area: spaced(l) };
}
/** "PewterGym" -> "Pewter Gym", "2FRooms" -> "2F Rooms". */
const spaced = (s: string) =>
  s
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/(\dF)([A-Z])/g, "$1 $2")
    .trim();

const STARTER_BEATS: Record<string, string> = { charmander: "Bulbasaur", squirtle: "Charmander", bulbasaur: "Squirtle" };
const STARTER_LINES: Record<string, string[]> = {
  charmander: ["CHARMANDER", "CHARMELEON", "CHARIZARD"],
  squirtle: ["SQUIRTLE", "WARTORTLE", "BLASTOISE"],
  bulbasaur: ["BULBASAUR", "IVYSAUR", "VENUSAUR"],
};

export function importGen1(root: string, game: "red-blue" | "yellow"): Gen1Out {
  const { classLabels, parties } = parseGen1Parties(read(root, "data/trainers/parties.asm"));
  const names = parseGen1ClassNames(read(root, "data/trainers/names.asm"));
  const consts = parseGen1ClassConstants(read(root, "constants/trainer_constants.asm"));
  if (names.length !== classLabels.length) throw new Error(`class name count ${names.length} != ${classLabels.length}`);

  // Species constant order = EvosMovesPointerTable order.
  const speciesOrder = [...read(root, "constants/pokemon_constants.asm").matchAll(/^\s*(const_skip|const\s+(\w+))/gm)].map((m) => m[2] ?? "").slice(1); // drop NO_MON; const_skip keeps its slot
  const { order, sets } = parseGen1Learnsets(read(root, "data/pokemon/evos_moves.asm"));
  const learnsetOf = new Map<string, Learnset>();
  order.forEach((label, i) => learnsetOf.set(speciesOrder[i], sets.get(label) ?? []));
  const baseOf = new Map<string, string[]>();
  const bsDir = path.join(root, "data/pokemon/base_stats");
  for (const f of fs.readdirSync(bsDir)) {
    const t = fs.readFileSync(path.join(bsDir, f), "utf8");
    const dex = /db\s+DEX_(\w+)/.exec(t)?.[1];
    const lv1 = /db\s+([\w, ]+?)\s*;\s*level 1 learnset/.exec(t)?.[1];
    if (!dex || !lv1) continue;
    baseOf.set(dex, operands(lv1).filter((m) => m !== "NO_MOVE").map(moveSlug));
  }

  // Who stands where.
  const placed = new Map<string, Set<string>>();
  const objDir = path.join(root, "data/maps/objects");
  for (const f of fs.readdirSync(objDir)) {
    const label = f.replace(/\.asm$/, "");
    for (const o of parseGen1Objects(fs.readFileSync(path.join(objDir, f), "utf8"))) {
      const key = `${o.cls}:${o.no}`;
      if (!placed.has(key)) placed.set(key, new Set());
      placed.get(key)!.add(label);
    }
  }

  // Gym leader LoneMoves index (Red/Blue).
  const loneNo = new Map<string, number>();
  const specialMoves = read(root, "data/trainers/special_moves.asm");
  const isYellow = game === "yellow";
  if (!isYellow) {
    for (const f of fs.readdirSync(path.join(root, "scripts")).filter((x) => /Gym\.asm$/.test(x))) {
      const t = fs.readFileSync(path.join(root, "scripts", f), "utf8");
      const m = /ld a, (\$?\w+)\s*\n\s*ld \[wGymLeaderNo\], a/.exec(t);
      if (!m) continue;
      const map = f.replace(/\.asm$/, "");
      const objs = parseGen1Objects(read(root, `data/maps/objects/${map}.asm`));
      const leaderClasses = ["BROCK", "MISTY", "LT_SURGE", "ERIKA", "KOGA", "SABRINA", "BLAINE", "GIOVANNI"];
      const leader = objs.find((o) => leaderClasses.includes(o.cls));
      if (leader) loneNo.set(`${leader.cls}:${leader.no}`, parseNum(m[1]));
    }
  }
  const lone = [...(specialMoves.split("TeamMoves:")[0] ?? "").matchAll(/^\s*db\s+(\d+),\s*(\w+)/gm)].map((m) => ({ idx: Number(m[1]), move: m[2] }));
  const teamMoves = new Map([...(specialMoves.split("TeamMoves:")[1] ?? "").matchAll(/^\s*db\s+(\w+),\s*(\w+)/gm)].filter((m) => m[1] !== "-1").map((m) => [m[1], m[2]]));
  // Yellow: db class, no / db mon, slot, move … / db 0
  const yellowMoves = new Map<string, { mon: number; slot: number; move: string }[]>();
  if (isYellow) {
    let cur: { mon: number; slot: number; move: string }[] | null = null;
    for (const raw of specialMoves.split("SpecialTrainerMoves:")[1].split("\n")) {
      const body = stripAsm(raw);
      if (!body.startsWith("db ")) continue;
      const ops = operands(body.slice(3));
      if (ops.length === 2) {
        cur = [];
        yellowMoves.set(`${ops[0]}:${parseNum(ops[1])}`, cur);
      } else if (ops.length === 3 && cur) cur.push({ mon: Number(ops[0]), slot: Number(ops[1]), move: ops[2] });
      else if (ops.length === 1 && ops[0] === "0") cur = null;
      else if (ops[0] === "-1" || ops[0] === "$ff") break;
    }
  }

  const teams: RawTeam[] = [];
  // Group = consecutive parties under one comment inside a class.
  const groupPlaces = new Map<string, Set<string>>();
  for (const p of parties) {
    const key = `${consts[p.cls]}:${p.no}`;
    const g = `${p.cls}:${p.block}`;
    for (const label of placed.get(key) ?? []) {
      if (!groupPlaces.has(g)) groupPlaces.set(g, new Set());
      groupPlaces.get(g)!.add(label);
    }
  }

  for (const p of parties) {
    const clsConst = consts[p.cls];
    const key = `${clsConst}:${p.no}`;
    const named = p.comment === "Jessie & James";
    const comment = p.inline ?? (named ? undefined : p.comment);
    if (comment && /^(unused|none)$/i.test(comment)) continue;
    // Rival battles are scripted: their map objects carry a placeholder OPP_RIVAL1, 1, so trust the party comments.
    const isRival = /^RIVAL/.test(clsConst);
    let labels = isRival ? [] : [...(placed.get(key) ?? [])];
    if (!labels.length && comment && !comment.includes("/") && !/first byte/.test(comment)) labels = [comment];
    if (!labels.length && !isRival) labels = [...(groupPlaces.get(`${p.cls}:${p.block}`) ?? [])];
    // Uncommented rival blocks: the first battle in Oak's Lab and the Champion battle.
    if (!labels.length && isRival && !comment) labels = clsConst === "RIVAL1" ? ["OaksLab"] : clsConst === "RIVAL3" ? ["ChampionsRoom"] : [];

    const mons = p.mons.map((m) => {
      const base = baseOf.get(m.species) ?? [];
      const ls = learnsetOf.get(m.species);
      if (!ls) throw new Error(`No learnset for ${m.species}`);
      const moves = defaultMoves(m.level, ls, base);
      return { species: m.species, level: m.level, moves, custom: false };
    });
    // Engine overrides (read_trainer_party.asm).
    if (!isYellow && p.special) {
      const ln = loneNo.get(key) ?? 0;
      if (ln) {
        const e = lone[ln - 1];
        const mon = mons[e.idx];
        if (mon) setSlot(mon, 2, moveSlug(e.move));
      } else if (teamMoves.has(clsConst)) {
        const mon = mons[4];
        if (mon) setSlot(mon, 2, moveSlug(teamMoves.get(clsConst)!));
      } else if (clsConst === "RIVAL3") {
        setSlot(mons[0], 2, moveSlug("SKY_ATTACK"));
        const last = mons[5]?.species;
        setSlot(mons[5], 2, moveSlug(last === "VENUSAUR" ? "MEGA_DRAIN" : last === "CHARIZARD" ? "FIRE_BLAST" : "BLIZZARD"));
      }
    }
    if (isYellow) {
      for (const o of yellowMoves.get(key) ?? []) {
        const mon = mons[o.mon - 1];
        if (mon) setSlot(mon, o.slot - 1, moveSlug(o.move));
      }
    }

    let tag: string | undefined;
    if (/^RIVAL/.test(clsConst) && !isYellow) {
      for (const [starter, line] of Object.entries(STARTER_LINES)) if (p.mons.some((m) => line.includes(m.species))) tag = `If you chose ${STARTER_BEATS[starter]}`;
    }
    teams.push({
      id: `${clsConst}-${p.no}`,
      clsConst,
      cls: gen1ClassName(names[p.cls - 1], clsConst),
      ...(named ? { name: "Jessie & James" } : {}),
      places: labels.map((l) => ({ ...gen1Place(l), region: "Kanto" })),
      tag,
      team: mons.map((m) => ({ s: speciesId(m.species), lv: m.level, m: m.moves.filter(Boolean), ...(m.custom ? {} : { d: 1 as const }) })),
    });
  }
  return { teams };
}

/** In Gen I a move written into a slot past the known moves still lands in that slot. */
function setSlot(mon: { moves: string[]; custom: boolean }, slot: number, move: string) {
  while (mon.moves.length < slot) mon.moves.push("");
  mon.moves[slot] = move;
  mon.custom = true;
}

function gen1ClassName(name: string, c: string): string {
  if (/^RIVAL\d$/.test(c)) return "Rival";
  const fixed: Record<string, string> = { PROF_OAK: "Prof. Oak", LT_SURGE: "Lt. Surge", JR_TRAINER_M: "Jr. Trainer♂", JR_TRAINER_F: "Jr. Trainer♀", COOLTRAINER_M: "Cooltrainer♂", COOLTRAINER_F: "Cooltrainer♀", POKEMANIAC: "PokéManiac" };
  return fixed[c] ?? titleName(name);
}
