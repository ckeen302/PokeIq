import type { EncounterKind } from "./model";
import { GIFT_KINDS, STATIC_KINDS, allBosses, capFor, givesBadge, type GameView, type ViewBoss, type ViewMon } from "./view";

/**
 * A Nuzlocke run: what the player has logged, area by area, and every Pokémon caught. Changed only through the pure
 * functions below (each returns a new run), so the screens, the share links and the tests share one set of rules.
 * Tested in tests/nuzlocke.test.ts.
 */

export const RUN_VERSION = 1;
export const TEAM_SIZE = 6;
export const NAME_MAX = 40;
export const NICK_MAX = 24;
export const TEXT_MAX = 60;
/** The most badges a game without boss data can count by hand (HeartGold & SoulSilver have 16). */
export const BADGES_MAX = 16;

export type MonStatus = "team" | "box" | "dead";

export interface Death {
  /** The species that fainted it, by number. */
  by?: number;
  /** Or what did it, in the player's words ("Brock's Onix", "poison"). */
  byText?: string;
  /** Where it fell (an area id). */
  area?: string;
  level?: number;
  at: number;
}

export interface RunMon {
  id: string;
  /** The area it was met in. */
  area: string;
  /** What it is now (a key of the game view's `mons`; it changes when it evolves). */
  mon: string;
  /** What it was when it was caught. */
  met: string;
  nickname: string;
  status: MonStatus;
  shiny?: boolean;
  level?: number;
  /** Caught without using up its area's encounter (the shiny clause, or a gift or static encounter that doesn't count). */
  free?: boolean;
  /** How it was met (a gift, a trade…), when not in the wild. */
  kind?: EncounterKind;
  death?: Death;
  caughtAt: number;
}

/** An area's one encounter: caught (the Pokémon), failed (it fainted or ran), or skipped. */
export type AreaResult = { kind: "caught"; mon: string } | { kind: "failed"; met?: string } | { kind: "skipped" };

export interface Rules {
  dupes: boolean;
  shiny: boolean;
  /** Gifts, in-game trades, eggs and fossils use up the area's encounter. */
  gifts: boolean;
  /** Static and roaming encounters use up the area's encounter. */
  statics: boolean;
  /** Show the level caps. */
  caps: boolean;
}

export const DEFAULT_RULES: Rules = { dupes: true, shiny: true, gifts: true, statics: true, caps: true };

export interface Run {
  v: typeof RUN_VERSION;
  id: string;
  game: string;
  version: string;
  name: string;
  rules: Rules;
  /** Each area's encounter, by area id. */
  areas: Record<string, AreaResult>;
  /** Every Pokémon caught, in the order the team shows them. */
  mons: RunMon[];
  /** The bosses beaten, by key. */
  beaten: string[];
  /** Badges counted by hand, for a game whose data has no gym bosses. */
  badges: number;
  createdAt: number;
  updatedAt: number;
}

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 14).padEnd(12, "0");
}

export function createRun({ game, version, name, rules = DEFAULT_RULES, now = Date.now(), id = newId() }: { game: string; version: string; name: string; rules?: Rules; now?: number; id?: string }): Run {
  return { v: RUN_VERSION, id, game, version, name: name.trim().slice(0, NAME_MAX), rules: { ...rules }, areas: {}, mons: [], beaten: [], badges: 0, createdAt: now, updatedAt: now };
}

const touch = (run: Run, patch: Partial<Run>, now = Date.now()): Run => ({ ...run, ...patch, updatedAt: Math.max(now, run.updatedAt) });
const putMon = (run: Run, id: string, f: (m: RunMon) => RunMon): RunMon[] => run.mons.map((m) => (m.id === id ? f(m) : m));

/* ---------- Reading a run ---------- */

export const team = (run: Run): RunMon[] => run.mons.filter((m) => m.status === "team");
export const box = (run: Run): RunMon[] => run.mons.filter((m) => m.status === "box");
export const graveyard = (run: Run): RunMon[] => run.mons.filter((m) => m.status === "dead").sort((a, b) => (a.death?.at ?? 0) - (b.death?.at ?? 0));
export const getMon = (run: Run, id: string): RunMon | undefined => run.mons.find((m) => m.id === id);

export interface RunStats {
  caught: number;
  alive: number;
  dead: number;
}

export function stats(run: Run): RunStats {
  const dead = run.mons.filter((m) => m.status === "dead").length;
  return { caught: run.mons.length, alive: run.mons.length - dead, dead };
}

/** Whether an encounter of this kind uses up its area's one encounter under these rules. */
export function counts(rules: Rules, kind: EncounterKind): boolean {
  if (GIFT_KINDS.includes(kind)) return rules.gifts;
  if (STATIC_KINDS.includes(kind)) return rules.statics;
  return true;
}

/** Whether a catch leaves its area open: a shiny under the shiny clause, or a kind that doesn't count. */
export const isFree = (rules: Rules, kind: EncounterKind, shiny: boolean): boolean => (rules.shiny && shiny) || !counts(rules, kind);

/** The Pokémon caught in an area: the one its encounter counts first, then any that were free. */
export function monsIn(run: Run, area: string): RunMon[] {
  const r = run.areas[area];
  const main = r?.kind === "caught" ? run.mons.find((m) => m.id === r.mon) : undefined;
  return [...(main ? [main] : []), ...run.mons.filter((m) => m.area === area && m !== main)];
}

/* ---------- Logging an area ---------- */

export interface Catch {
  area: string;
  /** The Pokémon met (a key of the game view's `mons`). */
  mon: string;
  kind: EncounterKind;
  shiny?: boolean;
  nickname?: string;
  level?: number;
}

/**
 * Logs a catch. It takes the area's encounter unless it's free (see isFree); a catch that isn't free in an area whose
 * encounter is already logged changes nothing. It joins the team while there's room, else the box.
 */
export function logCatch(run: Run, c: Catch, now = Date.now(), id = newId()): { run: Run; mon: RunMon | null } {
  const free = isFree(run.rules, c.kind, !!c.shiny);
  if (!free && run.areas[c.area]) return { run, mon: null };
  const mon: RunMon = {
    id,
    area: c.area,
    mon: c.mon,
    met: c.mon,
    nickname: (c.nickname ?? "").trim().slice(0, NICK_MAX),
    status: team(run).length < TEAM_SIZE ? "team" : "box",
    caughtAt: now,
    ...(c.shiny && { shiny: true }),
    ...(free && { free: true }),
    ...(c.kind !== "wild" && { kind: c.kind }),
    ...(c.level && { level: clampLevel(c.level) }),
  };
  return { run: touch(run, { mons: [...run.mons, mon], ...(!free && { areas: { ...run.areas, [c.area]: { kind: "caught", mon: id } } }) }, now), mon };
}

/** The area's encounter got away (it fainted or fled); `met` is what it was, if the player says. */
export function logFailed(run: Run, area: string, met?: string, now = Date.now()): Run {
  if (run.areas[area]) return run;
  return touch(run, { areas: { ...run.areas, [area]: met ? { kind: "failed", met } : { kind: "failed" } } }, now);
}

export function skipArea(run: Run, area: string, now = Date.now()): Run {
  if (run.areas[area]) return run;
  return touch(run, { areas: { ...run.areas, [area]: { kind: "skipped" } } }, now);
}

/** Opens the area again: its result goes, and with it the Pokémon its encounter caught. Free catches stay. */
export function clearArea(run: Run, area: string, now = Date.now()): Run {
  const r = run.areas[area];
  if (!r) return run;
  const areas = { ...run.areas };
  delete areas[area];
  return touch(run, { areas, mons: r.kind === "caught" ? run.mons.filter((m) => m.id !== r.mon) : run.mons }, now);
}

/** Removes a Pokémon logged by mistake; if it was its area's encounter, the area opens again. */
export function removeMon(run: Run, id: string, now = Date.now()): Run {
  const m = getMon(run, id);
  if (!m) return run;
  const areas = { ...run.areas };
  const r = areas[m.area];
  if (r?.kind === "caught" && r.mon === id) delete areas[m.area];
  return touch(run, { areas, mons: run.mons.filter((x) => x.id !== id) }, now);
}

/* ---------- A Pokémon ---------- */

const clampLevel = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

export function rename(run: Run, id: string, nickname: string, now = Date.now()): Run {
  return touch(run, { mons: putMon(run, id, (m) => ({ ...m, nickname: nickname.trim().slice(0, NICK_MAX) })) }, now);
}

export function setLevel(run: Run, id: string, level: number | null, now = Date.now()): Run {
  return touch(
    run,
    {
      mons: putMon(run, id, (m) => {
        const next = { ...m };
        if (level === null || !Number.isFinite(level)) delete next.level;
        else next.level = clampLevel(level);
        return next;
      }),
    },
    now
  );
}

export function evolve(run: Run, id: string, to: string, now = Date.now()): Run {
  return touch(run, { mons: putMon(run, id, (m) => ({ ...m, mon: to })) }, now);
}

export function setShiny(run: Run, id: string, shiny: boolean, now = Date.now()): Run {
  return touch(
    run,
    {
      mons: putMon(run, id, (m) => {
        const next: RunMon = { ...m, shiny };
        if (!shiny) delete next.shiny;
        return next;
      }),
    },
    now
  );
}

/**
 * Moves a Pokémon to the team, the box or the graveyard. The team holds six: moving a seventh in changes nothing
 * (swap() trades places with a team member instead). A Pokémon leaving the graveyard (a mistake fixed) loses its death.
 */
export function setStatus(run: Run, id: string, status: MonStatus, death?: Omit<Death, "at"> & { at?: number }, now = Date.now()): Run {
  const m = getMon(run, id);
  if (!m) return run;
  if (status === "team" && m.status !== "team" && team(run).length >= TEAM_SIZE) return run;
  if (status === m.status && status !== "dead") return run;
  const next: RunMon = { ...m, status };
  if (status === "dead") {
    const d: Death = { at: death?.at ?? now };
    if (death?.by) d.by = death.by;
    if (death?.byText?.trim()) d.byText = death.byText.trim().slice(0, TEXT_MAX);
    if (death?.area) d.area = death.area;
    if (death?.level) d.level = clampLevel(death.level);
    next.death = d;
    if (d.level && (!m.level || d.level > m.level)) next.level = d.level;
  } else delete next.death;
  // Joining the team puts it last in the team's order.
  const others = run.mons.filter((x) => x.id !== id);
  const mons = status === "team" && m.status !== "team" ? [...others.filter((x) => x.status === "team"), next, ...others.filter((x) => x.status !== "team")] : run.mons.map((x) => (x.id === id ? next : x));
  return touch(run, { mons }, now);
}

/** A Pokémon from the box (or a revived one) takes a team member's place; that one goes to the box. */
export function swap(run: Run, into: string, out: string, now = Date.now()): Run {
  const a = getMon(run, into);
  const b = getMon(run, out);
  if (!a || !b || b.status !== "team" || a.status === "team") return run;
  const joined: RunMon = { ...a, status: "team" };
  delete joined.death;
  const left: RunMon = { ...b, status: "box" };
  // Each takes the other's place: the newcomer the leaver's spot in the team's order, the leaver its spot in the box.
  return touch(run, { mons: run.mons.map((m) => (m.id === out ? joined : m.id === into ? left : m)) }, now);
}

/** Puts a team member at a place in the team's order (0 first). */
export function moveInTeam(run: Run, id: string, to: number, now = Date.now()): Run {
  const members = team(run);
  const from = members.findIndex((m) => m.id === id);
  if (from < 0) return run;
  const order = [...members];
  const [m] = order.splice(from, 1);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, m);
  return touch(run, { mons: [...order, ...run.mons.filter((x) => x.status !== "team")] }, now);
}

/* ---------- Bosses, badges and the level cap ---------- */

export function toggleBoss(run: Run, key: string, now = Date.now()): Run {
  return touch(run, { beaten: run.beaten.includes(key) ? run.beaten.filter((k) => k !== key) : [...run.beaten, key] }, now);
}

const badgeBosses = (view: Pick<GameView, "steps">) => allBosses(view).filter(givesBadge);

/** The badges won: the gym bosses beaten, or the hand count for a game whose data has none. */
export function badgeCount(run: Run, view: Pick<GameView, "steps">): number {
  const gyms = badgeBosses(view);
  return gyms.length ? gyms.filter((b) => run.beaten.includes(b.key)).length : run.badges;
}

/** The most badges this game's data can count (null when they're counted by hand). */
export function badgeTotal(view: Pick<GameView, "steps">): number | null {
  const n = badgeBosses(view).length;
  return n || null;
}

/** One more badge: the next gym boss in story order is beaten (or the hand count goes up). */
export function addBadge(run: Run, view: Pick<GameView, "steps">, now = Date.now()): { run: Run; boss: ViewBoss | null } {
  const gyms = badgeBosses(view);
  if (!gyms.length) return { run: run.badges >= BADGES_MAX ? run : touch(run, { badges: run.badges + 1 }, now), boss: null };
  const next = gyms.find((b) => !run.beaten.includes(b.key));
  return next ? { run: touch(run, { beaten: [...run.beaten, next.key] }, now), boss: next } : { run, boss: null };
}

/** One badge fewer: the last gym boss beaten, in story order, isn't any more (or the hand count goes down). */
export function removeBadge(run: Run, view: Pick<GameView, "steps">, now = Date.now()): { run: Run; boss: ViewBoss | null } {
  const gyms = badgeBosses(view);
  if (!gyms.length) return { run: run.badges <= 0 ? run : touch(run, { badges: run.badges - 1 }, now), boss: null };
  const last = [...gyms].reverse().find((b) => run.beaten.includes(b.key));
  return last ? { run: touch(run, { beaten: run.beaten.filter((k) => k !== last.key) }, now), boss: last } : { run, boss: null };
}

/** The level cap: the first boss in story order not yet beaten whose cap is known for this version. */
export function levelCap(run: Pick<Run, "beaten" | "version">, view: Pick<GameView, "steps">): { boss: ViewBoss; cap: number } | null {
  for (const b of allBosses(view)) {
    if (run.beaten.includes(b.key)) continue;
    const cap = capFor(b, run.version);
    if (cap !== undefined) return { boss: b, cap };
  }
  return null;
}

/* ---------- The dupes clause ---------- */

/**
 * The Pokémon already caught from this one's evolution family (alive first), or null: under the dupes clause a first
 * encounter of a family already caught may be passed over. Every Pokémon caught counts, the fallen too.
 */
export function dupeOf(run: Run, view: Pick<GameView, "mons">, key: string): RunMon | null {
  const family = view.mons[key]?.family;
  if (family === undefined) return null;
  const rank = { team: 0, box: 1, dead: 2 } as const;
  const same = run.mons.filter((m) => view.mons[m.mon]?.family === family || view.mons[m.met]?.family === family);
  return same.sort((a, b) => rank[a.status] - rank[b.status])[0] ?? null;
}

/** The families caught so far. */
export function caughtFamilies(run: Run, view: Pick<GameView, "mons">): Set<number> {
  const out = new Set<number>();
  for (const m of run.mons) for (const k of [m.mon, m.met]) if (view.mons[k]) out.add(view.mons[k].family);
  return out;
}

/* ---------- Rules and names ---------- */

export const setRules = (run: Run, rules: Rules, now = Date.now()): Run => touch(run, { rules: { ...rules } }, now);
export const renameRun = (run: Run, name: string, now = Date.now()): Run => touch(run, { name: name.trim().slice(0, NAME_MAX) || run.name }, now);

/** The name a Pokémon shows: its nickname, else its species'. */
export const displayName = (m: RunMon, mon: ViewMon | undefined): string => m.nickname || mon?.name || "?";
