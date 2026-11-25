import { DEFAULT_SITUATION, GAMES, STATUSES, type GameId, type Situation, type Status } from "./formula";
import { LAST_ID } from "./species";

/**
 * The calculator's inputs as a query string, so a link opens the same encounter:
 * ?p=25&g=sv&l=30&hp=500&s=sleep&t=1&dark=1&water=1&fish=1&caught=1&you=50&love=1&dex=320&charm=1&grass=1&pow=2&off=1&b=5
 * `hp` is the HP left in thousandths of the maximum (1–1000). Anything missing or out of range falls back to the
 * default, so a mangled link still opens a working page.
 */
export interface Inputs extends Situation {
  id: number;
  game: GameId;
  level: number;
  /** HP left, thousandths of max HP (1–1000). */
  hp: number;
  status: Status;
}

export const DEFAULT_INPUTS: Inputs = { id: 25, game: "sv", level: 30, hp: 1000, status: "none", ...DEFAULT_SITUATION };
export const MAX_LEVEL = 100;
export const MAX_TURN = 30;
/** The most species a Pokédex can count as caught (the National Pokédex today). */
export const MAX_DEX = 1025;

type Query = Record<string, string | string[] | undefined> | URLSearchParams;
const get = (q: Query, k: string): string | undefined => {
  if (q instanceof URLSearchParams) return q.get(k) ?? undefined;
  const v = q[k];
  return Array.isArray(v) ? v[0] : v;
};
const int = (v: string | undefined, min: number, max: number, dflt: number) => {
  if (v === undefined || !/^\d{1,4}$/.test(v)) return dflt;
  const n = Number(v);
  return n >= min && n <= max ? n : dflt;
};
const flag = (v: string | undefined) => v === "1";

export function decodeInputs(q: Query): Inputs {
  const d = DEFAULT_INPUTS;
  const game = get(q, "g");
  const status = get(q, "s");
  return {
    id: int(get(q, "p"), 1, LAST_ID, d.id),
    game: GAMES.some((g) => g.id === game) ? (game as GameId) : d.game,
    level: int(get(q, "l"), 1, MAX_LEVEL, d.level),
    hp: int(get(q, "hp"), 1, 1000, d.hp),
    status: (STATUSES as readonly string[]).includes(status ?? "") ? (status as Status) : d.status,
    turn: int(get(q, "t"), 1, MAX_TURN, d.turn),
    dark: flag(get(q, "dark")),
    water: flag(get(q, "water")),
    fishing: flag(get(q, "fish")),
    caught: flag(get(q, "caught")),
    yourLevel: int(get(q, "you"), 1, MAX_LEVEL, d.yourLevel),
    loveMatch: flag(get(q, "love")),
    dex: int(get(q, "dex"), 0, MAX_DEX, d.dex),
    charm: flag(get(q, "charm")),
    darkGrass: flag(get(q, "grass")),
    power: int(get(q, "pow"), 0, 3, d.power),
    offGuard: flag(get(q, "off")),
    badges: int(get(q, "b"), 0, 8, d.badges),
  };
}

/** Whether a query names an encounter at all (a shared link). */
export const hasInputs = (q: Query): boolean => get(q, "p") !== undefined;

/** The query string for these inputs (defaults left out, except the Pokémon, so it always reads as a shared link). */
export function encodeInputs(i: Inputs): string {
  const d = DEFAULT_INPUTS;
  const out = new URLSearchParams();
  out.set("p", String(i.id));
  if (i.game !== d.game) out.set("g", i.game);
  if (i.level !== d.level) out.set("l", String(i.level));
  if (i.hp !== d.hp) out.set("hp", String(i.hp));
  if (i.status !== d.status) out.set("s", i.status);
  if (i.turn !== d.turn) out.set("t", String(i.turn));
  if (i.dark) out.set("dark", "1");
  if (i.water) out.set("water", "1");
  if (i.fishing) out.set("fish", "1");
  if (i.caught) out.set("caught", "1");
  if (i.yourLevel !== d.yourLevel) out.set("you", String(i.yourLevel));
  if (i.loveMatch) out.set("love", "1");
  if (i.dex !== d.dex) out.set("dex", String(i.dex));
  if (i.charm) out.set("charm", "1");
  if (i.darkGrass) out.set("grass", "1");
  if (i.power !== d.power) out.set("pow", String(i.power));
  if (i.offGuard) out.set("off", "1");
  if (i.badges !== d.badges) out.set("b", String(i.badges));
  return out.toString();
}
