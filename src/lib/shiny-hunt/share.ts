import { GAMES, getGame, getMethod, type ChoiceId, type GameId, type MethodId } from "./odds";
import { COUNT_MAX, LAST_SPECIES, elapsed, type Hunt } from "./store";

/**
 * A hunt's share link: the hunt itself in the URL (?d=…), so a link shows what was shared with no database.
 *   1.<species>.<game>.<method>.<flags>.<chain>.<choices>.<count>.<minutes>.<phases>.<found>
 * flags: 1 Shiny Charm, 2 Lure; choices: each of the method's choices as its option's index ("-" for none);
 * found: the day it was found as yyyymmdd (0 while hunting).
 */

export const SHARE_VERSION = 1;

export interface SharedHunt {
  species: number;
  game: GameId;
  method: MethodId;
  charm: boolean;
  lure: boolean;
  chain: number;
  choices: Partial<Record<ChoiceId, string>>;
  count: number;
  minutes: number;
  phases: number;
  /** yyyymmdd, or null while hunting. */
  found: number | null;
}

const GAME_CODE = new Map(GAMES.map((g, i) => [g.id, i.toString(36)]));

/** The day (in the hunter's own time zone) as yyyymmdd. */
export function day(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function encodeHunt(h: Hunt): string {
  const m = getMethod(h.game, h.method);
  const choices = (m?.choices ?? []).map((c) => Math.max(0, c.options.findIndex((o) => o.id === h.choices[c.id]))).join("") || "-";
  const found = h.status === "found" || h.found ? h.found : null;
  const ms = found ? found.timeMs : elapsed(h);
  return [
    SHARE_VERSION,
    h.species,
    GAME_CODE.get(h.game),
    h.method,
    (h.charm ? 1 : 0) | (h.lure ? 2 : 0),
    h.chain,
    choices,
    found ? found.count : h.count,
    Math.round(ms / 60_000),
    h.phases.length,
    found ? day(found.date) : 0,
  ].join(".");
}

const num = (s: string | undefined, max: number): number | null => (s && /^\d{1,9}$/.test(s) && Number(s) <= max ? Number(s) : null);

export function decodeHunt(raw: string | null | undefined): SharedHunt | null {
  if (!raw || raw.length > 120) return null;
  const p = raw.split(".");
  if (p.length !== 11 || p[0] !== String(SHARE_VERSION)) return null;
  const species = num(p[1], LAST_SPECIES);
  const gameIndex = p[2] && /^[0-9a-z]$/.test(p[2]) ? parseInt(p[2], 36) : -1;
  const game = GAMES[gameIndex]?.id;
  if (!species || !game) return null;
  const m = getMethod(game, p[3]);
  if (!m) return null;
  const flags = num(p[4], 3);
  const chain = num(p[5], 9999);
  const count = num(p[7], COUNT_MAX);
  const minutes = num(p[8], 99_999_999);
  const phases = num(p[9], 999);
  const found = p[10] === "0" ? null : num(p[10], 99_991_231);
  if (flags === null || chain === null || count === null || minutes === null || phases === null || (p[10] !== "0" && (found === null || found < 19_990_101))) return null;
  const choices: Partial<Record<ChoiceId, string>> = {};
  const cs = m.choices ?? [];
  if (cs.length) {
    if (!new RegExp(`^\\d{${cs.length}}$`).test(p[6])) return null;
    for (let i = 0; i < cs.length; i++) {
      const o = cs[i].options[Number(p[6][i])];
      if (!o) return null;
      choices[cs[i].id] = o.id;
    }
  } else if (p[6] !== "-") return null;
  return { species, game: getGame(game)!.id, method: m.id, charm: !!(flags & 1), lure: !!(flags & 2), chain, choices, count, minutes, phases, found };
}

/** yyyymmdd as a Date at noon UTC (so no time zone moves it to another day). */
export function foundDate(found: number): Date {
  return new Date(Date.UTC(Math.floor(found / 10000), (Math.floor(found / 100) % 100) - 1, found % 100, 12));
}
