import { Battle, type Pokemon, type Side } from "@pkmn/client";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import { Protocol } from "@pkmn/protocol";
import { LogFormatter } from "@pkmn/view";

/**
 * The battle as one player sees it, rebuilt line by line from their own
 * channel of the protocol: @pkmn/client tracks the state (only what this
 * player has been shown), @pkmn/view writes Showdown's text. Each line
 * becomes a Step for the animation queue, and the screen draws plain
 * snapshots, never the tracker's live objects.
 */

export const gens = new Generations(Dex);
export const gen9 = gens.get(9);

export type SideId = "p1" | "p2";
export const other = (side: SideId): SideId => (side === "p1" ? "p2" : "p1");

export interface SlotRef {
  side: SideId;
  slot: number;
}

export interface MonSnap {
  /** Stable within its side (Showdown's original ident). */
  key: string;
  name: string;
  /** The current forme, e.g. "Ogerpon-Wellspring". */
  species: string;
  speciesId: string;
  num: number;
  level: number;
  gender: string;
  shiny: boolean;
  /** Exact for your own Pokémon; out of 100 for the opponent's. */
  hp: number;
  maxhp: number;
  status: string;
  fainted: boolean;
  boosts: Record<string, number>;
  volatiles: string[];
  types: string[];
  teraType?: string;
  terastallized?: string;
  item: string;
  ability: string;
  moves: string[];
}

export interface SideSnap {
  id: SideId;
  name: string;
  active: (MonSnap | null)[];
  team: MonSnap[];
  total: number;
  /** Hazards, screens and the like; turns left as Showdown counts them (min to max; 0: no end). */
  conditions: { id: string; name: string; level: number; turns?: [number, number] }[];
}

export interface Snap {
  /** The battle's generation (from its `|gen|` line; 9 until then). */
  gen: number;
  turn: number;
  sides: Record<SideId, SideSnap>;
  weather: string;
  terrain: string;
  pseudo: string[];
  /** Turns left (min to max) for the weather, the terrain and each field effect, where they run out. */
  turns?: Record<string, [number, number]>;
}

export interface Step {
  cmd: string;
  args: readonly string[];
  kw: Record<string, string | true | undefined>;
  text: string;
  /** Who acts (moves) or is affected (everything else). */
  who?: SlotRef;
  /** A move's targets (the first one for most moves). */
  targets?: SlotRef[];
  moveId?: string;
  /** The mon that was in `who`'s slot before a switch. */
  replaced?: string;
  snap?: Snap;
}

/** "p2a: Name" → p2, slot 0. */
export function slotOf(ident: string | undefined): SlotRef | undefined {
  const m = /^(p[12])([a-c])?:/.exec(ident ?? "");
  if (!m) return undefined;
  return { side: m[1] as SideId, slot: m[2] ? m[2].charCodeAt(0) - 97 : 0 };
}

const VOLATILES: Record<string, string> = {
  substitute: "Substitute",
  confusion: "Confused",
  leechseed: "Leech Seed",
  taunt: "Taunt",
  encore: "Encore",
  torment: "Torment",
  disable: "Disable",
  yawn: "Drowsy",
  perish3: "Perish 3",
  perish2: "Perish 2",
  perish1: "Perish 1",
  perish0: "Perish 0",
  focusenergy: "Focus Energy",
  magnetrise: "Magnet Rise",
  aquaring: "Aqua Ring",
  ingrain: "Ingrain",
  curse: "Cursed",
  nightmare: "Nightmare",
  partiallytrapped: "Trapped",
  trapped: "Can't escape",
  saltcure: "Salt Cure",
  smackdown: "Smacked Down",
  charge: "Charged",
  flashfire: "Flash Fire",
  stockpile1: "Stockpile 1",
  stockpile2: "Stockpile 2",
  stockpile3: "Stockpile 3",
  typechange: "Type changed",
  transform: "Transformed",
  attract: "Infatuated",
  embargo: "Embargo",
  healblock: "Heal Block",
  throatchop: "Throat Chop",
  tarshot: "Tar Shot",
  octolock: "Octolock",
  noretreat: "No Retreat",
  dynamax: "Dynamax",
  slowstart: "Slow Start",
  glaiverush: "Glaive Rush",
  syrupbomb: "Syrup Bomb",
  protosynthesisatk: "Protosynthesis Atk",
  protosynthesisdef: "Protosynthesis Def",
  protosynthesisspa: "Protosynthesis SpA",
  protosynthesisspd: "Protosynthesis SpD",
  protosynthesisspe: "Protosynthesis Spe",
  quarkdriveatk: "Quark Drive Atk",
  quarkdrivedef: "Quark Drive Def",
  quarkdrivespa: "Quark Drive SpA",
  quarkdrivespd: "Quark Drive SpD",
  quarkdrivespe: "Quark Drive Spe",
};

function monSnap(p: Pokemon): MonSnap {
  const species = p.species;
  const volatiles = Object.keys(p.volatiles)
    .map((id) => VOLATILES[id])
    .filter((label): label is string => !!label);
  return {
    key: p.originalIdent,
    name: p.name,
    species: p.speciesForme,
    speciesId: species?.id ?? "",
    num: species?.num ?? 0,
    level: p.level,
    gender: p.gender ?? "",
    shiny: p.shiny,
    hp: p.hp,
    maxhp: p.maxhp || 100,
    status: p.status ?? "",
    fainted: p.fainted,
    boosts: Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v)) as Record<string, number>,
    volatiles,
    types: safeTypes(p),
    teraType: p.teraType,
    terastallized: p.terastallized,
    item: p.item ?? "",
    ability: p.ability ?? "",
    moves: p.moveSlots.map((m) => m.name),
  };
}

function safeTypes(p: Pokemon): string[] {
  try {
    if (p.terastallized) return [p.terastallized];
    return [...p.types];
  } catch {
    return [];
  }
}

function sideSnap(side: Side): SideSnap {
  return {
    id: side.id as SideId,
    name: side.name,
    active: side.active.map((p) => (p ? monSnap(p) : null)),
    team: side.team.map(monSnap),
    total: side.totalPokemon,
    conditions: Object.entries(side.sideConditions).map(([id, c]) => ({ id, name: c.name, level: c.level, ...(c.maxDuration ? { turns: [c.minDuration || c.maxDuration, c.maxDuration] as [number, number] } : {}) })),
  };
}

/** Lines that need no step at all. */
const QUIET = new Set(["", "t:", "gametype", "player", "gen", "tier", "rule", "teamsize", "upkeep", "inactive", "inactiveoff", "timer", "request", "debug", "seed", "split", "rated", "clearpoke", "teampreview", "j", "l", "n", "c", "chat", "raw", "html", "uhtml", "bigerror", "message"]);

export class BattleModel {
  readonly battle: Battle;
  readonly me: SideId;
  private readonly formatter: LogFormatter;

  constructor(me: SideId) {
    this.me = me;
    this.battle = new Battle(gens);
    this.formatter = new LogFormatter(me, this.battle);
  }

  /** Feeds one protocol line; returns its step (null for lines that show nothing). */
  feed(line: string): Step | null {
    let parsed: { args: readonly string[]; kwArgs: Record<string, string | true | undefined> };
    try {
      parsed = Protocol.parseBattleLine(line) as unknown as typeof parsed;
    } catch {
      return null;
    }
    const { args, kwArgs } = parsed;
    const cmd = args[0] ?? "";
    let text = "";
    try {
      // The formatter reads the state before the line is applied.
      text = this.formatter.formatText(args as never, kwArgs as never) ?? "";
    } catch {
      text = "";
    }
    const step: Step = { cmd, args, kw: kwArgs, text };
    const who = slotOf(args[1]);
    if (who) step.who = who;
    if (cmd === "move") {
      step.moveId = Dex.moves.get(args[2] ?? "").id;
      const target = slotOf(args[3]);
      step.targets = target ? [target] : [];
      if (typeof kwArgs.spread === "string") step.targets = kwArgs.spread.split(",").map((t) => slotOf(`${t}:`)).filter((t): t is SlotRef => !!t);
    }
    if ((cmd === "switch" || cmd === "drag" || cmd === "replace") && who) {
      step.replaced = this.battle[who.side].active[who.slot]?.originalIdent;
    }
    try {
      this.battle.add(args as never, kwArgs as never);
    } catch (err) {
      console.error("[battle] couldn't track", line, err);
    }
    if (QUIET.has(cmd) && !text.trim()) return null;
    return step;
  }

  snapshot(): Snap {
    const b = this.battle;
    return {
      gen: b.gen.num,
      turn: b.turn,
      sides: { p1: sideSnap(b.p1), p2: sideSnap(b.p2) },
      weather: b.field.weather ?? "",
      terrain: b.field.terrain ?? "",
      pseudo: Object.keys(b.field.pseudoWeather),
      turns: fieldTurns(b),
    };
  }
}

/** Turns left for the weather ("weather"), the terrain ("terrain") and each pseudo-weather, where Showdown's client knows them. */
function fieldTurns(b: Battle): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const add = (id: string, s: { minDuration: number; maxDuration: number } | undefined) => {
    if (s?.maxDuration) out[id] = [s.minDuration || s.maxDuration, s.maxDuration];
  };
  if (b.field.weather) add("weather", b.field.weatherState);
  if (b.field.terrain) add("terrain", b.field.terrainState);
  for (const [id, s] of Object.entries(b.field.pseudoWeather)) add(id, s);
  return out;
}

/**
 * Showdown's text markup, as plain segments: **bold**, and ||exact||percent||
 * damage (we keep the percent; your own HP bar shows the exact numbers).
 */
export function textLines(text: string): { bold: boolean; text: string }[][] {
  return text
    .replace(/\|\|[^|]*\|\|([^|]*)\|\|/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith("**") ? { bold: true, text: part.slice(2, -2) } : { bold: false, text: part })));
}

export const plainText = (text: string) =>
  textLines(text)
    .map((line) => line.map((p) => p.text).join(""))
    .join(" ");
