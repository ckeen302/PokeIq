import type { Athlete } from "./athlete";
import { allAroundPoints, type Marks } from "./allround";
import { EVENT_IDS, MARK_EVENTS, eventOf, type EventId, type MarkEvent } from "./events";
import { runHighJump, type HighJumpResult } from "./highjump";
import { runLift, type LiftResult } from "./lift";
import { runLongJump, type LongJumpResult } from "./longjump";
import { sprintEvent, SPRINT_EVENTS, type SprintEventResult, type SprintEvent } from "./sprint";
import { runSwim, SWIM_EVENTS, type SwimEvent, type SwimRace } from "./swim";
import { runThrow, type ThrowResult } from "./throws";
import { runBracket, type Bracket } from "./wrestle";

/**
 * The Games: the schedule, every event's competition, and the medal table.
 * Pure and unit-tested.
 *
 * - Single event: up to eight athletes, one competition (heats come in
 *   only when more than eight run).
 * - The Games: up to eight nations of three. A nation is a type (Team Fire,
 *   Team Water…: its three best all-rounders) or a team the player builds.
 *   Every athlete enters every event: heats or a qualifying round when more
 *   than eight compete, then the final. The all-around closes the Games,
 *   scored from each athlete's best marks.
 * - The medal table ranks nations by golds, then silvers, then bronzes
 *   (equal on all three share a rank). Pound for pound in the
 *   weightlifting is its own award, outside the table.
 */

export interface Podium {
  gold: string[];
  silver: string[];
  bronze: string[];
}

export type EventResult =
  | { kind: "sprint"; result: SprintEventResult }
  | { kind: "jump-long"; result: LongJumpResult; qualifying: LongJumpResult | null }
  | { kind: "jump-high"; result: HighJumpResult }
  | { kind: "throw"; result: ThrowResult; qualifying: ThrowResult | null }
  | { kind: "lift"; result: LiftResult }
  | { kind: "swim"; result: SwimRace; heats: SwimRace[] | null }
  | { kind: "wrestle"; result: Bracket }
  | { kind: "combined"; result: AllAroundResult };

export interface EventOutcome {
  event: EventId;
  podium: Podium;
  /** Each athlete's best mark in it (null: no mark; wrestling has none). */
  marks: Map<string, number | null>;
  /** Final standings (keys), best first. */
  standings: string[];
  detail: EventResult;
}

export interface AllAroundRow {
  key: string;
  total: number;
  points: Record<MarkEvent, number>;
  place: number;
}

export interface AllAroundResult {
  rows: AllAroundRow[];
}

export interface EventOptions {
  /** The swims' rain toggle (Swift Swim). */
  rain?: boolean;
  /** For the all-around: every athlete's marks so far (the Games), else each event is run here. */
  marks?: Map<string, Marks>;
}

const byPlace = <T extends { place: number }>(rows: T[], key: (r: T) => string): Podium => ({
  gold: rows.filter((r) => r.place === 1).map(key),
  silver: rows.filter((r) => r.place === 2).map(key),
  bronze: rows.filter((r) => r.place === 3).map(key),
});

/** Top `n` cards of a field event's qualifying round go through to the final. */
const qualifiers = <T extends { athlete: Athlete }>(order: T[], n = 8) => order.slice(0, n).map((c) => c.athlete);

export function runEvent(event: EventId, athletes: Athlete[], seed: number, o: EventOptions = {}): EventOutcome {
  const e = eventOf(event);
  const marks = new Map<string, number | null>();
  switch (e.kind) {
    case "sprint": {
      const result = sprintEvent(athletes, event as SprintEvent, seed);
      const runs = result.final.order;
      // Heat times count for those who didn't make the final.
      if (result.heats) for (const r of result.heats) for (const h of r.heats) for (const x of h.results) marks.set(x.key, x.time >= 1e5 ? null : x.time);
      for (const r of runs) marks.set(r.athlete.key, r.dq ? marks.get(r.athlete.key) ?? null : Math.min(r.time, marks.get(r.athlete.key) ?? Infinity));
      const finalKeys = runs.map((r) => r.athlete.key);
      const rest = athletes.map((a) => a.key).filter((k) => !finalKeys.includes(k)).sort((x, y) => (marks.get(x) ?? 1e9) - (marks.get(y) ?? 1e9));
      return { event, podium: byPlace(runs.filter((r) => !r.dq), (r) => r.athlete.key), marks, standings: [...finalKeys, ...rest], detail: { kind: "sprint", result } };
    }
    case "jump": {
      if (event === "high-jump") {
        const result = runHighJump(athletes, seed);
        for (const c of result.cards) marks.set(c.athlete.key, c.best);
        return { event, podium: byPlace(result.order.filter((c) => c.best != null), (c) => c.athlete.key), marks, standings: result.order.map((c) => c.athlete.key), detail: { kind: "jump-high", result } };
      }
      const qualifying = athletes.length > 8 ? runLongJump(athletes, seed + 101) : null;
      const finalists = qualifying ? qualifiers(qualifying.order) : athletes;
      const result = runLongJump(finalists, seed);
      for (const c of qualifying?.cards ?? []) marks.set(c.athlete.key, c.best);
      for (const c of result.cards) marks.set(c.athlete.key, Math.max(c.best ?? -1, marks.get(c.athlete.key) ?? -1) < 0 ? null : Math.max(c.best ?? -1, marks.get(c.athlete.key) ?? -1));
      const keys = result.order.map((c) => c.athlete.key);
      const rest = (qualifying?.order ?? []).map((c) => c.athlete.key).filter((k) => !keys.includes(k));
      return { event, podium: byPlace(result.order.filter((c) => c.best != null), (c) => c.athlete.key), marks, standings: [...keys, ...rest], detail: { kind: "jump-long", result, qualifying } };
    }
    case "throw": {
      const implement = event === "shot-put" ? "shot" : "javelin";
      const qualifying = athletes.length > 8 ? runThrow(athletes, implement, seed + 101) : null;
      const finalists = qualifying ? qualifiers(qualifying.order) : athletes;
      const result = runThrow(finalists, implement, seed);
      for (const c of qualifying?.cards ?? []) marks.set(c.athlete.key, c.best);
      for (const c of result.cards) {
        const best = Math.max(c.best ?? -1, marks.get(c.athlete.key) ?? -1);
        marks.set(c.athlete.key, best < 0 ? null : best);
      }
      const keys = result.order.map((c) => c.athlete.key);
      const rest = (qualifying?.order ?? []).map((c) => c.athlete.key).filter((k) => !keys.includes(k));
      return { event, podium: byPlace(result.order.filter((c) => c.best != null), (c) => c.athlete.key), marks, standings: [...keys, ...rest], detail: { kind: "throw", result, qualifying } };
    }
    case "lift": {
      const result = runLift(athletes, seed);
      for (const c of result.cards) marks.set(c.athlete.key, c.best);
      return { event, podium: byPlace(result.order.filter((c) => c.best != null), (c) => c.athlete.key), marks, standings: result.order.map((c) => c.athlete.key), detail: { kind: "lift", result } };
    }
    case "swim": {
      const ev = event as SwimEvent;
      let heats: SwimRace[] | null = null;
      let finalists = athletes;
      if (athletes.length > 8) {
        // Heats of up to eight, seeded across the heats; the eight fastest times overall swim the final (World Aquatics).
        const n = Math.ceil(athletes.length / 8);
        const groups: Athlete[][] = Array.from({ length: n }, () => []);
        athletes.forEach((a, i) => groups[i % n].push(a));
        heats = groups.map((g, i) => runSwim(g, ev, seed, !!o.rain, `heat${i + 1}`));
        const all = heats.flatMap((h) => h.runs).sort((x, y) => x.photo - y.photo || x.athlete.key.localeCompare(y.athlete.key));
        for (const r of all) marks.set(r.athlete.key, r.time);
        finalists = all.slice(0, 8).map((r) => r.athlete);
      }
      const result = runSwim(finalists, ev, seed, !!o.rain);
      for (const r of result.runs) marks.set(r.athlete.key, Math.min(r.time, marks.get(r.athlete.key) ?? Infinity));
      const keys = result.order.map((r) => r.athlete.key);
      const rest = athletes.map((a) => a.key).filter((k) => !keys.includes(k)).sort((x, y) => (marks.get(x) ?? 1e9) - (marks.get(y) ?? 1e9));
      return { event, podium: byPlace(result.order, (r) => r.athlete.key), marks, standings: [...keys, ...rest], detail: { kind: "swim", result, heats } };
    }
    case "wrestle": {
      const result = runBracket(athletes, seed);
      return { event, podium: { gold: [result.gold.key], silver: result.silver ? [result.silver.key] : [], bronze: result.bronzeMedal ? [result.bronzeMedal.key] : [] }, marks, standings: result.order.map((a) => a.key), detail: { kind: "wrestle", result } };
    }
    case "combined": {
      const all = o.marks ?? new Map<string, Marks>();
      if (!o.marks) {
        for (const id of MARK_EVENTS) {
          const out = runEvent(id, athletes, seed, o);
          for (const a of athletes) {
            const m = all.get(a.key) ?? {};
            m[id] = out.marks.get(a.key) ?? null;
            all.set(a.key, m);
          }
        }
      }
      const rows: AllAroundRow[] = athletes.map((a) => ({ key: a.key, ...allAroundPoints(all.get(a.key) ?? {}), place: 0 }));
      rows.sort((x, y) => y.total - x.total || x.key.localeCompare(y.key));
      rows.forEach((r, k) => { r.place = k > 0 && r.total === rows[k - 1].total ? rows[k - 1].place : k + 1; marks.set(r.key, r.total); });
      return { event, podium: byPlace(rows, (r) => r.key), marks, standings: rows.map((r) => r.key), detail: { kind: "combined", result: { rows } } };
    }
  }
}

// ---------------------------------------------------------------------------
// Nations and the medal table
// ---------------------------------------------------------------------------

export const TYPE_COLORS: Record<string, string> = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};
export const NATION_TYPES = Object.keys(TYPE_COLORS);

export interface Nation {
  /** "fire" for a type nation, "x-<a>.<b>.<c>" for a built team. */
  id: string;
  name: string;
  type: string | null;
  color: string;
  athletes: Athlete[];
}

export const MAX_NATIONS = 8;
export const NATION_SIZE = 3;

export interface MedalRow {
  nation: Nation;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  rank: number;
}

export function medalTable(nations: Nation[], outcomes: EventOutcome[]): MedalRow[] {
  const of = new Map<string, Nation>();
  for (const n of nations) for (const a of n.athletes) of.set(a.key, n);
  const rows = new Map<Nation, MedalRow>(nations.map((n) => [n, { nation: n, gold: 0, silver: 0, bronze: 0, total: 0, rank: 0 }]));
  for (const o of outcomes) {
    for (const [medal, keys] of [["gold", o.podium.gold], ["silver", o.podium.silver], ["bronze", o.podium.bronze]] as const) {
      for (const k of keys) {
        const n = of.get(k);
        if (!n) continue;
        rows.get(n)![medal]++;
        rows.get(n)!.total++;
      }
    }
  }
  const out = [...rows.values()].sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.nation.name.localeCompare(b.nation.name));
  out.forEach((r, k) => {
    const p = out[k - 1];
    r.rank = p && p.gold === r.gold && p.silver === r.silver && p.bronze === r.bronze ? p.rank : k + 1;
  });
  return out;
}

export interface GamesResult {
  nations: Nation[];
  outcomes: EventOutcome[];
  table: MedalRow[];
  /** The all-around's winner. */
  champion: string | null;
  /** Pound for pound: the weightlifting's own award. */
  poundForPound: string | null;
}

/** Every event in order, then the all-around from each athlete's best marks. */
export function runGames(nations: Nation[], seed: number, o: { rain?: boolean } = {}): GamesResult {
  const athletes = nations.flatMap((n) => n.athletes);
  const outcomes: EventOutcome[] = [];
  const marks = new Map<string, Marks>(athletes.map((a) => [a.key, {}]));
  for (const id of EVENT_IDS) {
    if (id === "all-around") continue;
    const out = runEvent(id, athletes, seed, o);
    outcomes.push(out);
    if ((MARK_EVENTS as readonly string[]).includes(id)) for (const a of athletes) marks.get(a.key)![id as MarkEvent] = out.marks.get(a.key) ?? null;
  }
  const aa = runEvent("all-around", athletes, seed, { ...o, marks });
  outcomes.push(aa);
  const lift = outcomes.find((x) => x.event === "weightlifting");
  const p4p = lift?.detail.kind === "lift" ? lift.detail.result.p4p.find((c) => c.p4p != null)?.athlete.key ?? null : null;
  return { nations, outcomes, table: medalTable(nations, outcomes), champion: aa.podium.gold[0] ?? null, poundForPound: p4p };
}

export const isSprint = (id: EventId): id is SprintEvent => id in SPRINT_EVENTS;
export const isSwim = (id: EventId): id is SwimEvent => id in SWIM_EVENTS;

export const typeLabel = (t: string) => t[0].toUpperCase() + t.slice(1);

export type NationSpec = { type: string } | { keys: string[] };

/**
 * Nations for the Games: built teams claim their athletes first, then each
 * type nation takes its best three all-rounders that no other nation has
 * (`candidates`: each type's best first, from the records).
 */
export function buildNations(specs: NationSpec[], byKey: ReadonlyMap<string, Athlete>, candidates: Record<string, string[]>): Nation[] {
  const taken = new Set<string>();
  const out: (Nation | null)[] = specs.map(() => null);
  specs.forEach((s, i) => {
    if (!("keys" in s)) return;
    const athletes = s.keys.map((k) => byKey.get(k)).filter((a): a is Athlete => !!a && !taken.has(a.key)).slice(0, NATION_SIZE);
    if (!athletes.length) return;
    athletes.forEach((a) => taken.add(a.key));
    out[i] = { id: `x-${athletes.map((a) => a.key).join(".")}`, name: `Team ${athletes[0].name}`, type: null, color: TYPE_COLORS[athletes[0].types[0]] ?? "#9fd8ff", athletes };
  });
  specs.forEach((s, i) => {
    if (!("type" in s) || !TYPE_COLORS[s.type]) return;
    const athletes = (candidates[s.type] ?? []).filter((k) => !taken.has(k)).map((k) => byKey.get(k)).filter((a): a is Athlete => !!a).slice(0, NATION_SIZE);
    if (!athletes.length) return;
    athletes.forEach((a) => taken.add(a.key));
    out[i] = { id: s.type, name: `Team ${typeLabel(s.type)}`, type: s.type, color: TYPE_COLORS[s.type], athletes };
  });
  return out.filter((n): n is Nation => !!n).slice(0, MAX_NATIONS);
}
