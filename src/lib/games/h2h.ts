import type { Athlete } from "./athlete";
import { eventOf, floorCm, formatMark, formatSeconds, localNum, type EventId } from "./events";
import { runEvent, type EventOutcome } from "./games";
import { translator, type Translator } from "@/i18n/catalog";
import gamesEvents from "@/messages/games-events";

/**
 * Head to heads: two Pokémon, one event. How a result reads ("Snorlax
 * wins by 12 kg"), and example match-ups found by running the real events
 * (never chosen by hand): the closest finishes and the results that go
 * against the stat the event leans on most. Pure and client-safe.
 */

export interface H2HSide {
  key: string;
  name: string;
  /** "212 kg", "9.81 s"; wrestling: "Winner" / "Pushed out". */
  mark: string;
  win: boolean;
}

export interface H2HSummary {
  /** In the question's order: [the one asked about, the rival]. */
  sides: [H2HSide, H2HSide];
  winner: string | null;
  /** "Snorlax wins by 12 kg", "A dead heat at 9.81 s". */
  line: string;
  /** The gap as a share of the winning mark (0: a dead heat; null: no mark to compare). */
  gap: number | null;
}

/** The gap between two marks as it's read out: "0.08 s", "12 cm", "12 kg", "84 pts". */
export function formatGap(id: EventId, d: number, locale = "en"): string {
  const u = eventOf(id).unit;
  if (u === "s") return localNum(`${formatSeconds(Math.abs(d))} s`, locale);
  if (u === "m") { const cm = Math.round(floorCm(Math.abs(d)) * 100); return localNum(cm < 100 ? `${cm} cm` : `${(cm / 100).toFixed(2)} m`, locale); }
  if (u === "kg") return localNum(`${Math.round(Math.abs(d)).toLocaleString("en-US")} kg`, locale);
  if (u === "pts") return formatMark("all-around", Math.round(Math.abs(d)), locale);
  return "";
}

export function h2hSummary(o: EventOutcome, a: Athlete, b: Athlete, t: Translator<typeof gamesEvents.en> = translator(gamesEvents, "en", undefined)): H2HSummary {
  const lc = t.locale;
  const gold = o.podium.gold;
  const dead = gold.includes(a.key) && gold.includes(b.key);
  const winKey = dead ? null : gold[0] ?? o.standings[0] ?? null;
  if (o.event === "wrestling") {
    const d = o.detail.kind === "wrestle" ? o.detail.result : null;
    const bout = d?.rounds[d.rounds.length - 1]?.bouts[0];
    const ringOut = bout?.trace?.ringOut ?? false;
    const loseMark = t(ringOut ? "summary.pushedOut" : "summary.lostOnBell");
    const side = (x: Athlete): H2HSide => ({ key: x.key, name: x.name, win: x.key === winKey, mark: x.key === winKey ? t("summary.winner") : loseMark });
    const w = winKey === a.key ? a : b, l = w === a ? b : a;
    return { sides: [side(a), side(b)], winner: winKey, gap: null, line: ringOut ? t("summary.pushesOut", { w: w.name, l: l.name }) : t("summary.winsOnBell", { w: w.name }) };
  }
  const ma = o.marks.get(a.key) ?? null, mb = o.marks.get(b.key) ?? null;
  const none = t(eventOf(o.event).kind === "lift" ? "summary.noLift" : "summary.noMark");
  const side = (x: Athlete, m: number | null): H2HSide => ({ key: x.key, name: x.name, win: x.key === winKey || dead, mark: m == null ? none : formatMark(o.event, m, lc) });
  const sides: [H2HSide, H2HSide] = [side(a, ma), side(b, mb)];
  if (dead) return { sides, winner: null, gap: 0, line: t("summary.deadHeat", { mark: formatMark(o.event, ma, lc) }) };
  const w = winKey === a.key ? a : b;
  const mw = w === a ? ma : mb, ml = w === a ? mb : ma;
  if (mw == null) return { sides, winner: null, gap: null, line: t("summary.neither") };
  if (ml == null) return { sides, winner: winKey, gap: null, line: t("summary.winsWith", { w: w.name, mark: formatMark(o.event, mw, lc) }) };
  const gap = Math.abs(mw - ml) / Math.max(1e-9, Math.abs(mw));
  // (Marks are read out rounded: a gap under the last digit is a win on the photo or on countback.)
  const g = formatGap(o.event, mw - ml, lc);
  const shown = formatMark(o.event, mw) === formatMark(o.event, ml);
  return { sides, winner: winKey, gap, line: shown ? t("summary.winsOnPhoto", { w: w.name }) : t("summary.winsBy", { w: w.name, gap: g }) };
}

export interface Matchup {
  event: EventId;
  a: string;
  b: string;
  /** Why it's worth watching: a close finish, or a result against the event's main stat. */
  why: "close" | "upset";
  score: number;
}

/** The value of the stat an event leans on most (its first listed stat). */
function mainStat(id: EventId, x: Athlete): number {
  const k = eventOf(id).stats[0];
  return k === "kg" ? x.kg : k === "height" ? x.height : x.stats[k];
}

/** How interesting a finished head to head is (null: not at all). */
export function rateMatchup(o: EventOutcome, a: Athlete, b: Athlete): Omit<Matchup, "event" | "a" | "b"> | null {
  const s = h2hSummary(o, a, b);
  // Both need a mark to compare (a no-lift or three fouls isn't a contest).
  if (o.event !== "wrestling" && (o.marks.get(a.key) == null || o.marks.get(b.key) == null)) return null;
  if (!s.winner) return { why: "close", score: 3 };
  const w = s.winner === a.key ? a : b, l = w === a ? b : a;
  const sw = mainStat(o.event, w), sl = mainStat(o.event, l);
  // An upset: the winner gives away a lot of the event's main stat.
  const upset = sl > 0 ? (sl - sw) / sl : 0;
  const close = s.gap == null ? 0 : Math.max(0, 1 - s.gap / 0.03);
  if (upset >= 0.3) return { why: "upset", score: 1 + upset + close * 0.5 };
  if (close > 0) return { why: "close", score: close * 1.6 };
  return null;
}

/**
 * Example head to heads, found by running every pair of `pool` in each
 * event (the given seed: the share link's default day, so a link replays
 * the same result): the best per event, a Pokémon at most twice, up to
 * `n`. With `with`, only that Pokémon's own match-ups.
 */
export function findMatchups(pool: Athlete[], seed: number, o: { events: EventId[]; n: number; with?: Athlete }): Matchup[] {
  const found: Matchup[] = [];
  for (const event of o.events) {
    let best: Matchup | null = null;
    const pairs: [Athlete, Athlete][] = [];
    if (o.with) for (const x of pool) { if (x.key !== o.with.key) pairs.push([o.with, x]); }
    else for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i], pool[j]]);
    const runs = pairs.map(([a, b]) => ({ a, b, out: runEvent(event, [a, b], seed) }));
    // A result worth showing has a real mark: the winner's is at least the middle of everyone's in these runs.
    const better = eventOf(event).better === "lower" ? -1 : 1;
    const all = runs.flatMap((r) => [...r.out.marks.values()]).filter((m): m is number => m != null).sort((x, y) => better * (x - y));
    const mid = all.length ? all[Math.floor(all.length / 2)] : null;
    for (const { a, b, out } of runs) {
      const r = rateMatchup(out, a, b);
      if (!r) continue;
      if (event === "wrestling") {
        const d = out.detail.kind === "wrestle" ? out.detail.result : null;
        if (!d?.rounds[d.rounds.length - 1]?.bouts[0]?.trace?.ringOut) continue;
      } else {
        const w = out.marks.get(out.standings[0]);
        if (mid != null && (w == null || better * (w - mid) < 0)) continue;
      }
      // Ask about the underdog: "Can Pikachu out-lift Snorlax?" reads best when the answer surprises.
      const [q, v] = o.with ? [a, b] : mainStat(event, a) <= mainStat(event, b) ? [a, b] : [b, a];
      if (!best || r.score > best.score) best = { event, a: q.key, b: v.key, ...r };
    }
    if (best) found.push(best);
  }
  found.sort((x, y) => y.score - x.score);
  const used = new Map<string, number>();
  const out: Matchup[] = [];
  for (const m of found) {
    // (A Pokémon's own match-ups are all its; the rest, at most twice each.)
    if ([m.a, m.b].some((k) => k !== o.with?.key && (used.get(k) ?? 0) >= 2)) continue;
    out.push(m);
    used.set(m.a, (used.get(m.a) ?? 0) + 1);
    used.set(m.b, (used.get(m.b) ?? 0) + 1);
    if (out.length === o.n) break;
  }
  return out;
}
