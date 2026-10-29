import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEO_SEASON_STARTS,
  GEO_SEASON_TRACK,
  GEO_SEASON_WEEKS,
  geoRewardLabel,
  geoSeason,
  geoSeasonAt,
  geoSeasonBadge,
  geoSeasonReset,
  geoSeasonRewards,
  geoSeasonStarts,
  geoSeasonTimeLeft,
  geoSeasonUnlocks,
} from "@/lib/geo-seasons";
import { GEO_DIVISIONS, geoDivisionOf, utcDay } from "@/lib/geo-ranked";
import { replayHp, replayStep, replaySteps } from "@/lib/geo-duel-history";
import {
  clearMemoryGeoRanked,
  ensureGeoSeason,
  geoRankedKey,
  geoSeasonViewOf,
  memoryGeoRankedStore,
  settleGeoRanked,
  type GeoRankedStore,
} from "@/lib/server/geo-ranked";
import {
  canShareReplay,
  canViewReplay,
  clearMemoryHistory,
  historyItemFor,
  historyRowOf,
  keepFinishedDuel,
  memoryHistoryStore,
  replayFor,
  stampHistoryKey,
  type HistoryRow,
} from "@/lib/server/geo-duel-history";
import { createDuel, guessDuel, joinDuel, leaveDuel, readyDuel, touchDuel, withGeoRankedResult, type Duel, type DuelOutcome } from "@/lib/server/duel";
import { WORLD_REGION } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const DAY = 86_400_000;
const SEASON_MS = GEO_SEASON_WEEKS * 7 * DAY;
const S1 = Date.parse(`${GEO_SEASON_STARTS[0]}T00:00:00Z`);

describe("season boundaries", () => {
  it("starts each season at 00:00 UTC on its date and runs eight weeks", () => {
    expect(geoSeasonAt(S1 - 1)).toBeNull();
    expect(geoSeasonAt(S1)).toMatchObject({ number: 1, name: "Kanto Season", start: GEO_SEASON_STARTS[0] });
    expect(geoSeasonAt(S1 + SEASON_MS - 1)?.number).toBe(1);
    expect(geoSeasonAt(S1 + SEASON_MS)).toMatchObject({ number: 2, name: "Johto Season" });
    expect(geoSeasonAt(S1 + 9 * SEASON_MS)?.name).toBe("Season 10");
    const s1 = geoSeason(1);
    expect(s1.endsAt - s1.startsAt).toBe(SEASON_MS);
    expect(s1.end).toBe(geoSeason(2).start);
  });

  it("lists the start dates the database needs, through the next season's", () => {
    expect(geoSeasonStarts(2)).toEqual([geoSeason(1).start, geoSeason(2).start, geoSeason(3).start]);
  });

  it("says how long is left", () => {
    expect(geoSeasonTimeLeft(S1 + SEASON_MS, S1)).toBe("56 days left");
    expect(geoSeasonTimeLeft(S1 + 5 * 3_600_000, S1)).toBe("5 hours left");
    expect(geoSeasonTimeLeft(S1 + 60_000, S1)).toBe("1 minute left");
  });
});

describe("the soft reset", () => {
  it("compresses halfway toward 1,000 but drops at most one division", () => {
    expect(geoSeasonReset(1000)).toBe(1000);
    expect(geoSeasonReset(1090)).toBe(1045);
    expect(geoSeasonReset(1100)).toBe(1050);
    expect(geoSeasonReset(1200)).toBe(1100);
    expect(geoSeasonReset(1350)).toBe(1200);
    expect(geoSeasonReset(1500)).toBe(1350);
    expect(geoSeasonReset(1900)).toBe(1450);
  });

  it("never raises a rating, never swaps two trainers, and keeps everyone within one division", () => {
    let prev = -Infinity;
    for (let elo = 1000; elo <= 2400; elo++) {
      const r = geoSeasonReset(elo);
      expect(r).toBeLessThanOrEqual(elo);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(geoDivisionOf(elo).index - geoDivisionOf(r).index).toBeLessThanOrEqual(1);
      prev = r;
    }
  });
});

describe("rewards", () => {
  it("grants the peak division's badge and the track up to it", () => {
    expect(geoSeasonRewards(1, "poke")).toEqual([geoSeasonBadge(1, "poke"), "emote:season-gg"]);
    const master = geoSeasonRewards(2, "master");
    expect(master[0]).toBe("badge:guessr-s2-master");
    for (const t of GEO_SEASON_TRACK.slice(0, 4)) for (const r of t.rewards) expect(master).toContain(r.id);
    for (const r of GEO_SEASON_TRACK[4].rewards) expect(master).not.toContain(r.id);
    expect(master.every((id) => /^(badge|ball|emote|trainer):[a-z0-9-]+$/.test(id))).toBe(true);
  });

  it("unions a trainer's seasons without repeats, and names every reward", () => {
    const all = geoSeasonUnlocks([
      { season: 2, peakDivision: "great" },
      { season: 1, peakDivision: "ultra" },
    ]);
    expect(all.filter((id) => id === "emote:season-gg")).toHaveLength(1);
    expect(all).toContain("badge:guessr-s1-ultra");
    expect(all).toContain("badge:guessr-s2-great");
    expect(geoRewardLabel("badge:guessr-s1-ultra")).toBe("Kanto Season Ultra Ball badge");
    for (const t of GEO_SEASON_TRACK) for (const r of t.rewards) expect(geoRewardLabel(r.id)).toBe(r.label);
    expect(GEO_SEASON_TRACK.map((t) => t.division)).toEqual(GEO_DIVISIONS.map((d) => d.id));
  });
});

describe("the lazy season roll-over", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMemoryGeoRanked();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearMemoryGeoRanked();
  });

  const red = geoRankedKey("a:red-season");
  const blue = geoRankedKey("a:blue-season");
  const duel = async (store: GeoRankedStore, code: string, winner: number, at: number) =>
    settleGeoRanked({ code, keys: [red, blue], names: ["Red", "Blue"], winner, at, points: [10_000, 5_000] }, store, { shockDiff: 0 });

  it("archives the season with its peak, resets ratings once, and starts the new season clean", async () => {
    const store = memoryGeoRankedStore();
    const mid = S1 + 10 * DAY;
    vi.setSystemTime(mid);
    // Red wins three and loses one: the peak is after the third win.
    await duel(store, "s1a", 0, mid);
    await duel(store, "s1b", 0, mid + 1000);
    const peak = (await duel(store, "s1c", 0, mid + 2000)).after[0];
    const final = (await duel(store, "s1d", 1, mid + 3000)).after[0];
    expect(final).toBeLessThan(peak);
    const during = await geoSeasonViewOf(store, red, mid + 4000);
    expect(during).toMatchObject({ number: 1, you: { games: 4, wins: 3, losses: 1, draws: 0, peakElo: peak }, history: [] });

    // The boundary passes. Nothing happens until the first ranked action.
    const next = S1 + SEASON_MS + 3600_000;
    vi.setSystemTime(next);
    expect((await store.rating(red, utcDay(next)))?.elo).toBe(final);
    const season = await ensureGeoSeason(store, next);
    expect(season?.number).toBe(2);
    expect((await store.rating(red, utcDay(next)))?.elo).toBe(geoSeasonReset(final));
    // Idempotent: another roll (another instance) changes nothing.
    expect(await store.rollSeason(2, utcDay(next))).toBe(0);
    expect((await store.rating(red, utcDay(next)))?.elo).toBe(geoSeasonReset(final));

    const view = await geoSeasonViewOf(store, red, next);
    expect(view?.you).toEqual({ games: 0, wins: 0, losses: 0, draws: 0, peakElo: null });
    expect(view?.history).toHaveLength(1);
    const record = view!.history![0];
    expect(record).toMatchObject({ season: 1, name: "Kanto Season", games: 4, wins: 3, losses: 1, finalElo: final, peakElo: peak });
    expect(record.peakDivision).toBe(geoDivisionOf(peak).id);
    expect(record.rewards).toEqual(geoSeasonRewards(1, record.peakDivision));
    expect((await geoSeasonViewOf(store, blue, next))?.history?.[0]).toMatchObject({ season: 1, games: 4, wins: 1, losses: 3 });

    // A duel in the new season counts from the reset rating and shows in the new season only.
    const s2 = await duel(store, "s2a", 0, next + 1000);
    expect(s2.before[0]).toBe(geoSeasonReset(final));
    expect((await geoSeasonViewOf(store, red, next + 2000))?.you).toMatchObject({ games: 1, wins: 1, peakElo: s2.after[0] });
  });

  it("gives a trainer who first played this season no record and no reset", async () => {
    const store = memoryGeoRankedStore();
    const t = S1 + SEASON_MS + DAY;
    vi.setSystemTime(t);
    await duel(store, "fresh", 0, t);
    const before = (await store.rating(red, utcDay(t)))!.elo;
    expect(await store.rollSeason(2, utcDay(t))).toBe(0);
    expect((await store.rating(red, utcDay(t)))!.elo).toBe(before);
    expect(await store.seasonHistory(red)).toEqual([]);
  });

  it("is only a name and a countdown before the first season", async () => {
    const store = memoryGeoRankedStore();
    expect(await geoSeasonViewOf(store, red, S1 - DAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Duel history
// ---------------------------------------------------------------------------

const T0 = S1 + 20 * DAY;
const must = (out: DuelOutcome): Duel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

/** A casual HP duel on the world map: both play round 1, then Blue leaves. Keys stamped as the route would. */
function playedDuel(code: string, keys: [string | null, string | null]): Duel {
  const made = createDuel(WORLD_REGION, "Red", code, T0, "seed-" + code);
  const joined = joinDuel(made.duel, "Blue", T0 + 1000);
  if (!joined.ok) throw new Error(joined.error);
  const ids = [made.playerId, joined.playerId];
  let d = must(readyDuel(must(readyDuel(joined.duel, ids[0], true, T0 + 2000)), ids[1], true, T0 + 2000));
  d = stampHistoryKey(stampHistoryKey(d, ids[0], keys[0]), ids[1], keys[1]);
  const start = d.rounds[0].startsAt;
  d = must(guessDuel(d, ids[0], 0, { x: 0.4, y: 0.4 }, start + 5000));
  d = must(guessDuel(d, ids[1], 0, { x: 0.6, y: 0.5 }, start + 6000));
  d = touchDuel(d, ids[0], start + 30_000);
  expect(d.rounds[0].result).toBeDefined();
  return must(leaveDuel(d, ids[1], start + 31_000));
}

describe("duel history", () => {
  const redKey = geoRankedKey("a:red-history");
  const blueKey = geoRankedKey("u:blue-history");
  const stranger = geoRankedKey("a:someone-else");

  beforeEach(() => clearMemoryHistory());

  it("keeps only public facts, from each trainer's seat", () => {
    const duel = playedDuel("hist0001", [redKey, blueKey]);
    const row = historyRowOf(duel)!;
    expect(row.keys).toEqual([redKey, blueKey]);
    expect(row.summary).toMatchObject({ mode: "hp", ranked: false, winner: 0, reason: "left", players: [{ name: "Red" }, { name: "Blue" }] });
    expect(row.rounds).toHaveLength(1);
    expect(row.rounds[0].guesses.every(Boolean)).toBe(true);
    expect(row.rounds[0].answer.pin).toHaveLength(2);
    const json = JSON.stringify({ summary: row.summary, rounds: row.rounds });
    expect(json).not.toContain(duel.seed);
    for (const p of duel.players) expect(json).not.toContain(p.id);
    expect(json).not.toContain(redKey);

    const listed = { ...row, public: false };
    expect(historyItemFor(listed, redKey)).toMatchObject({ result: "win", opponent: { name: "Blue" }, hp: [duel.hp[0], duel.hp[1]] });
    expect(historyItemFor(listed, blueKey)).toMatchObject({ result: "loss", opponent: { name: "Red" }, hp: [duel.hp[1], duel.hp[0]] });
    expect(historyItemFor(listed, stranger)).toBeNull();
  });

  it("shows a replay to its two trainers, and to others only once shared", () => {
    const row: HistoryRow = { ...historyRowOf(playedDuel("hist0002", [redKey, null]))!, public: false };
    expect(canViewReplay(row, redKey)).toBe(true);
    expect(canViewReplay(row, stranger)).toBe(false);
    expect(canViewReplay(row, null)).toBe(false);
    expect(replayFor(row, stranger)).toBeNull();
    expect(replayFor(row, redKey)?.you).toBe(0);
    const shared = { ...row, public: true };
    expect(replayFor(shared, stranger)?.you).toBeNull();
    expect(canShareReplay(shared, stranger)).toBe(false);
    expect(canShareReplay(shared, redKey)).toBe(true);
  });

  it("keeps nothing nobody can claim, and a ranked duel only once it's counted", () => {
    expect(historyRowOf(playedDuel("hist0003", [null, null]))).toBeNull();
    const casual = playedDuel("hist0004", [null, null]);
    const ranked: Duel = { ...casual, ranked: { keys: [redKey, blueKey], elos: [1100, 1120], games: [3, 4] } };
    expect(historyRowOf(ranked)).toBeNull();
    const counted = withGeoRankedResult(ranked, { before: [1100, 1120], after: [1116, 1104] });
    const row = historyRowOf(counted)!;
    expect(row.keys).toEqual([redKey, blueKey]);
    expect(historyItemFor({ ...row, public: false }, blueKey)?.elo).toEqual({ before: 1120, after: 1104 });
  });

  it("is kept once when the duel ends, listed newest first a page at a time, and stays shared when saved again", async () => {
    const store = memoryHistoryStore();
    const lobby = createDuel(WORLD_REGION, "Red", "hist0010", T0).duel;
    const ended = playedDuel("hist0010", [redKey, blueKey]);
    await keepFinishedDuel(lobby, ended, store);
    expect(await store.get("hist0010")).not.toBeNull();
    await store.setPublic("hist0010", true);
    // A later poll of the finished duel keeps nothing again.
    await keepFinishedDuel(ended, ended, store);
    for (let i = 1; i <= 4; i++) {
      const d = playedDuel(`hist002${i}`, [redKey, null]);
      await store.put(historyRowOf({ ...d, end: { ...d.end!, at: d.end!.at + i * 1000 } })!);
    }
    await store.put(historyRowOf(ended)!);
    expect((await store.get("hist0010"))?.public).toBe(true);
    const first = await store.list(redKey, null, 3);
    expect(first.map((r) => r.code)).toEqual(["hist0024", "hist0023", "hist0022"]);
    expect("rounds" in first[0]).toBe(false);
    const rest = await store.list(redKey, first[2].endedAt, 3);
    expect(rest.map((r) => r.code)).toEqual(["hist0021", "hist0010"]);
    expect((await store.list(blueKey, null, 10)).map((r) => r.code)).toEqual(["hist0010"]);
    expect(await store.list(stranger, null, 10)).toEqual([]);
  });

  it("steps through a replay: the shot, the pins, then the damage", () => {
    expect(replaySteps(3)).toBe(9);
    expect(replayStep(0, 3)).toEqual({ round: 0, phase: "shot" });
    expect(replayStep(4, 3)).toEqual({ round: 1, phase: "pins" });
    expect(replayStep(99, 3)).toEqual({ round: 2, phase: "damage" });
    const round = { hpBefore: [6000, 6000], hp: [6000, 4500] };
    expect(replayHp(round, "pins")).toEqual([6000, 6000]);
    expect(replayHp(round, "damage")).toEqual([6000, 4500]);
  });
});
