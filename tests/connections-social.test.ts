import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CATEGORIES } from "@/lib/connections/categories";
import { FACTS } from "@/lib/connections/facts";
import { generatePuzzle, playGuesses, validatePuzzle } from "@/lib/connections/generator";
import { CONN_LEVELS, type ConnLevel } from "@/lib/connections/types";
import {
  GROUP_STATS_MIN,
  beatPath,
  beatVerdict,
  compareScores,
  creatorPath,
  groupStatLine,
  type ConnGroupStats,
} from "@/lib/connections/social";
import { encodeShare, decodeShare } from "@/lib/share";
import { dailyConnPuzzle } from "@/lib/server/connections";
import { clearMemoryConnBoard, memoryConnBoard, startToken } from "@/lib/server/connections-board";
import { clearMemoryConnResults, connPlayerKey, memoryConnStore, recordConnResult } from "@/lib/server/connections-results";
import {
  beatToken,
  categoryFeedback,
  clearMemorySocial,
  disableCategory,
  effectiveDaily,
  friendsBoard,
  memorySocialStore,
  readBeatToken,
  recordGroupStats,
  requestHint,
  submitFeedback,
} from "@/lib/server/connections-social";
import { clearMemoryCustom, memoryCustomStore, publishCustom, voteCustom, type StoredCustom } from "@/lib/server/connections-custom";
import { creatorPage, isFeaturedCreator, pickPotd, puzzleOfTheDay } from "@/lib/server/connections-creators";
import { clearMemoryFriends, memoryFriendStore, pairOf } from "@/lib/server/friends-store";
import { POST as postFeedback } from "@/app/api/connections/feedback/route";
import { POST as postHint } from "@/app/api/connections/hint/route";
import { GET as getBeat } from "@/app/api/connections/beat/route";

const DATE = "2026-10-25";
const T = Date.parse(`${DATE}T12:00:00Z`);
const puzzle = dailyConnPuzzle(DATE);
const [y, g, b, p] = puzzle.groups.map((x) => x.members);
const miss = [y[0], y[1], g[0], g[1]];
const solve = (mistakes = 0) => [...[miss, [b[0], b[1], p[0], p[1]], [y[0], y[1], b[0], b[1]]].slice(0, mistakes), y, g, b, p];
const key = (who: string) => connPlayerKey(`d:${who}`);
const WHO = (n: number) => `player-${String(n).padStart(10, "0")}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T);
  clearMemorySocial();
  clearMemoryConnBoard();
  clearMemoryConnResults();
  clearMemoryCustom();
  clearMemoryFriends();
});
afterEach(() => vi.useRealTimers());

/** Every name and label a puzzle's groups could leak. */
const answerWords = () => [...puzzle.groups.flatMap((x) => x.members.map((id) => FACTS.find((f) => f.id === id)!.name)), ...puzzle.groups.map((x) => CATEGORIES.find((c) => c.id === x.category)!.label)];
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return answerWords().filter((w) => text.includes(w));
};

describe("categories moderators switch off", () => {
  const D2 = "2026-10-30";
  const base = dailyConnPuzzle(D2);
  const cat = base.groups[0].category;

  it("the generator never uses an excluded category", () => {
    const out = generatePuzzle("daily:probe", { excludeCategories: new Set([cat]) });
    expect(out.groups.map((x) => x.category)).not.toContain(cat);
    expect(validatePuzzle(out)).toEqual([]);
  });

  it("later dailies skip it, but that day and earlier ones stay as played", () => {
    const off = new Map([[cat, "2026-10-29"]]);
    const after = dailyConnPuzzle(D2, off);
    expect(after.groups.map((x) => x.category)).not.toContain(cat);
    expect(validatePuzzle(after)).toEqual([]);
    expect(dailyConnPuzzle(D2, off)).toEqual(after); // everyone gets the same one
    // Disabled on the day itself: that day's puzzle (maybe already played) is untouched.
    expect(dailyConnPuzzle(D2, new Map([[cat, D2]]))).toEqual(base);
    expect(dailyConnPuzzle(DATE, off)).toEqual(puzzle);
  });

  it("disableCategory stores it for the days after tomorrow and is idempotent", async () => {
    const store = memorySocialStore();
    const out = await disableCategory(cat, "mod", store, T);
    expect(out).toEqual({ ok: true, after: "2026-10-26" });
    expect(await disableCategory(cat, "mod", store, T + 5 * 86_400_000)).toEqual({ ok: true, after: "2026-10-26" });
    expect(await effectiveDaily("2026-10-26", store)).toEqual(dailyConnPuzzle("2026-10-26"));
    const later = await effectiveDaily(D2, store);
    expect(later.groups.map((x) => x.category)).not.toContain(cat);
    expect(await disableCategory("nope:nothing", "mod", store, T)).toMatchObject({ ok: false, status: 400 });
    expect(await disableCategory(cat, "mod", null, T)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("feedback and reports", () => {
  it("needs a finished game", async () => {
    const store = memorySocialStore();
    const out = await submitFeedback({ date: DATE, player: key("a"), guesses: [y], rating: 1 }, store);
    expect(out).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps one rating per player per puzzle and one report per group", async () => {
    const store = memorySocialStore();
    const input = { date: DATE, player: key("a"), guesses: solve(0) };
    expect(await submitFeedback({ ...input, rating: 1 }, store)).toMatchObject({ ok: true, rated: true });
    expect(await submitFeedback({ ...input, rating: -1 }, store)).toMatchObject({ ok: true, rated: false });
    const r = { level: 3 as ConnLevel, reason: "too-obscure" };
    expect(await submitFeedback({ ...input, report: r }, store)).toMatchObject({ ok: true, reported: true });
    expect(await submitFeedback({ ...input, report: r }, store)).toMatchObject({ ok: true, reported: false });
    expect(await submitFeedback({ ...input, report: { level: 0, reason: "unfair" } }, store)).toMatchObject({ reported: true });
    await submitFeedback({ date: DATE, player: key("b"), guesses: solve(0), rating: -1 }, store);
    expect(await store.ratings()).toEqual([{ date: DATE, up: 1, down: 1 }]);
  });

  it("the server finds the category itself and never repeats an answer back", async () => {
    const store = memorySocialStore();
    const out = await submitFeedback({ date: DATE, player: key("a"), guesses: solve(1), rating: 1, report: { level: 2, reason: "wrong-fact" } }, store);
    expect(leaks(out)).toEqual([]);
    expect(await store.reports()).toEqual([{ category: puzzle.groups[2].category, reason: "wrong-fact", count: 1 }]);
    expect(await submitFeedback({ date: DATE, player: key("a"), guesses: solve(0), report: { level: 1, reason: "bogus" } }, store)).toMatchObject({ ok: false, status: 400 });
  });

  it("is off, not an error, without a store", async () => {
    expect(await submitFeedback({ date: DATE, player: key("a"), guesses: solve(0), rating: 1 }, null)).toEqual({ ok: true, available: false, rated: false, reported: false });
  });

  it("the route rejects an empty body, a made-up reason, and unknown dates", async () => {
    const call = (body: unknown) => postFeedback(new NextRequest("http://x/api/connections/feedback", { method: "POST", body: JSON.stringify(body) }));
    expect((await call({ date: DATE, player: WHO(1), guesses: solve(0) })).status).toBe(400);
    expect((await call({ date: DATE, player: WHO(1), guesses: solve(0), report: { level: 0, reason: "rude" } })).status).toBe(400);
    expect((await call({ date: "2020-01-01", player: WHO(1), guesses: solve(0), rating: 1 })).status).toBe(400);
  });

  it("ranks categories for the moderators by reports, then by ratings", async () => {
    const store = memorySocialStore();
    for (const n of [1, 2, 3]) await submitFeedback({ date: DATE, player: key(`r${n}`), guesses: solve(0), report: { level: 3, reason: "unfair" } }, store);
    await submitFeedback({ date: DATE, player: key("d"), guesses: solve(0), rating: -1, report: { level: 0, reason: "wrong-fact" } }, store);
    const { stored, categories } = await categoryFeedback(store);
    expect(stored).toBe(true);
    expect(categories[0]).toMatchObject({ category: puzzle.groups[3].category, reports: 3, reasons: { unfair: 3, "wrong-fact": 0, "too-obscure": 0 } });
    expect(categories.every((c) => c.down >= 1 || c.reports >= 1)).toBe(true);
    const yellow = categories.find((c) => c.category === puzzle.groups[0].category)!;
    expect(yellow).toMatchObject({ reports: 1, down: 1, disabled: false });
    expect((await categoryFeedback(null)).stored).toBe(false);
  });
});

describe("group stats", () => {
  const stats = (players: number, pct: number[]): ConnGroupStats => ({ players, pct: pct as ConnGroupStats["pct"] });

  it("words the line, and waits for enough players", () => {
    expect(groupStatLine(stats(GROUP_STATS_MIN, [96, 80, 40, 12]), 3)).toBe("Only 12% found purple");
    expect(groupStatLine(stats(GROUP_STATS_MIN, [96, 80, 40, 12]), 0)).toBe("96% found yellow");
    expect(groupStatLine(stats(GROUP_STATS_MIN - 1, [96, 80, 40, 12]), 3)).toBeNull();
    expect(groupStatLine(undefined, 0)).toBeNull();
  });

  it("is counted from the replayed guesses, one result per player", async () => {
    const store = memorySocialStore();
    const win = playGuesses(puzzle, solve(0));
    const lost = playGuesses(puzzle, [miss, miss, [y[0], y[2], g[0], g[2]], [y[1], y[3], g[1], g[3]], y]);
    expect(lost.found).toEqual([0]);
    await recordGroupStats(DATE, key("a"), win, store);
    await recordGroupStats(DATE, key("a"), lost, store); // a second send changes nothing
    const out = await recordGroupStats(DATE, key("b"), lost, store);
    expect(out).toEqual({ players: 2, pct: [100, 50, 50, 50] });
  });

  it("the daily result carries them, and the route has no field to send numbers in", async () => {
    const social = memorySocialStore();
    const board = memoryConnBoard();
    const send = (who: string, guesses: number[][]) => recordConnResult({ date: DATE, identity: `d:${who}`, guesses, start: startToken(DATE, T - 60_000), name: who }, memoryConnStore(), T, board, social);
    await send(WHO(1), solve(0));
    const out = await send(WHO(2), [miss, [y[0], y[2], g[0], g[2]], [y[1], y[3], g[1], g[3]], [y[2], y[3], g[2], g[3]]]);
    expect(out).toMatchObject({ ok: true, hinted: false, groups: { players: 2, pct: [50, 50, 50, 50] } });
    // An unfinished game is refused: nothing is counted.
    expect(await send(WHO(3), [y])).toMatchObject({ ok: false, status: 409 });
    expect((await social.groupCounts(DATE)).players).toBe(2);
  });
});

describe("the hint", () => {
  const ask = (guesses: number[][], who = "a", store = memorySocialStore()) => requestHint({ date: DATE, player: key(who), guesses }, store);

  it("reveals one Pokémon of the easiest unsolved group, by colour only", async () => {
    const first = await ask([]);
    expect(first).toMatchObject({ ok: true, hint: { available: true, hint: { level: 0 } } });
    const hint = (first as { hint: { available: true; hint: { id: number; level: ConnLevel } } }).hint.hint;
    expect(y).toContain(hint.id);
    expect(Object.keys(hint).sort()).toEqual(["id", "level"]);
    expect(leaks(first).filter((w) => !FACTS.some((f) => f.name === w && f.id === hint.id))).toEqual([]);
    // With yellow found, the hint comes from green.
    const second = (await ask([y], "b")) as { hint: { available: true; hint: { id: number; level: ConnLevel } } };
    expect(second.hint.hint.level).toBe(1);
    expect(g).toContain(second.hint.hint.id);
  });

  it("is at most one per player per puzzle: asking again returns the same one", async () => {
    const store = memorySocialStore();
    const a = await ask([], "a", store);
    const again = await ask([y], "a", store); // yellow found since: still the first hint
    expect(again).toEqual(a);
    expect(await store.getHint(DATE, key("a"))).toMatchObject({ level: 0 });
    const other = await ask([], "c", store);
    expect(other).toMatchObject({ ok: true });
  });

  it("is refused once the game is over or on another day", async () => {
    expect(await ask(solve(0))).toMatchObject({ ok: false, status: 409 });
    expect(await requestHint({ date: "2026-10-20", player: key("a"), guesses: [] }, memorySocialStore())).toMatchObject({ ok: false, status: 400 });
  });

  it("is off, not an error, without a store", async () => {
    expect(await ask([], "a", null as never)).toMatchObject({ ok: true, hint: { available: false } });
  });

  it("the route validates its body", async () => {
    const call = (body: unknown) => postHint(new NextRequest("http://x/api/connections/hint", { method: "POST", body: JSON.stringify(body) }));
    expect((await call({ date: DATE, guesses: [[1, 2, 3]], player: WHO(1) })).status).toBe(400);
    expect((await call({ date: DATE, guesses: [] })).status).toBe(400); // no player id
  });

  it("is recorded server-side and ranks below every hint-free game", async () => {
    const social = memorySocialStore();
    const board = memoryConnBoard();
    await ask([], "fast-hinter", social);
    const send = (who: string, mistakes: number, ms: number) =>
      recordConnResult({ date: DATE, identity: `d:${who}`, guesses: solve(mistakes), start: startToken(DATE, T - ms), name: who }, memoryConnStore(), T, board, social);
    // The hinter's game is perfect and quick, and a hint-free game with 3 mistakes is slow: the hint-free one still ranks first.
    const hinted = await send("fast-hinter", 0, 10_000);
    const clean = await send("slow-clean", 3, 600_000);
    expect(hinted).toMatchObject({ ok: true, hinted: true, mine: { hinted: true, mistakes: 0 } });
    expect(clean).toMatchObject({ ok: true, hinted: false, board: { position: 1, total: 2 } });
    expect(await board.top(DATE, 10)).toMatchObject([{ name: "slow-clean" }, { name: "fast-hinter", hinted: true }]);
  });

  it("a client cannot claim it didn't use the hint", async () => {
    const social = memorySocialStore();
    await ask([], "x", social);
    const out = await recordConnResult({ date: DATE, identity: "d:x", guesses: solve(0), start: startToken(DATE, T - 1000), name: "x" }, memoryConnStore(), T, memoryConnBoard(), social);
    expect(out).toMatchObject({ ok: true, hinted: true });
  });
});

describe("ranking order", () => {
  it("hint-free first, then mistakes, then time", () => {
    const s = (hinted: boolean, mistakes: number, ms: number) => ({ hinted, mistakes, ms });
    expect(compareScores(s(false, 3, 999_999), s(true, 0, 1))).toBeLessThan(0);
    expect(compareScores(s(false, 1, 9), s(false, 2, 1))).toBeLessThan(0);
    expect(compareScores(s(false, 1, 5), s(false, 1, 9))).toBeLessThan(0);
    expect(beatVerdict(s(false, 0, 5), s(false, 0, 9))).toBe("beat");
    expect(beatVerdict(s(true, 0, 1), s(false, 2, 9))).toBe("lost");
    expect(beatVerdict(s(false, 1, 5), s(false, 1, 5))).toBe("tied");
  });
});

describe("friends board and Beat my time", () => {
  const user = (n: number) => `user-${n}`;
  const entry = (n: number, mistakes: number, durationMs: number, hinted = false) => ({ date: DATE, player: connPlayerKey(`u:${user(n)}`), name: `Trainer${n}`, mistakes, durationMs, hinted });

  it("shows you and your accepted friends only, best first", async () => {
    const friends = memoryFriendStore();
    const [a, bb] = pairOf(user(1), user(2));
    await friends.insertFriendship({ a, b: bb, requestedBy: user(1), status: "accepted", createdAt: T });
    const [c, d] = pairOf(user(1), user(3));
    await friends.insertFriendship({ a: c, b: d, requestedBy: user(3), status: "pending", createdAt: T });
    const board = memoryConnBoard();
    await board.record(entry(1, 1, 50_000));
    await board.record(entry(2, 0, 90_000, true));
    await board.record(entry(3, 0, 1_000));
    await board.record(entry(4, 0, 1_000));
    const rows = await friendsBoard(DATE, { id: user(1) }, friends, board, connPlayerKey);
    expect(rows).toEqual([
      { name: "Trainer1", mistakes: 1, ms: 50_000, hinted: false, you: true },
      { name: "Trainer2", mistakes: 0, ms: 90_000, hinted: true, you: false },
    ]);
    expect(await friendsBoard(DATE, { id: user(9) }, friends, board, connPlayerKey)).toEqual([]);
  });

  it("makes a signed link from your own ranked result, and nothing else", async () => {
    const board = memoryConnBoard();
    await board.record(entry(1, 2, 75_000));
    const token = await beatToken(DATE, connPlayerKey(`u:${user(1)}`), board);
    expect(token).toBeTruthy();
    expect(readBeatToken(token)).toEqual({ date: DATE, name: "Trainer1", mistakes: 2, ms: 75_000, hinted: false });
    expect(await beatToken(DATE, connPlayerKey(`u:${user(2)}`), board)).toBeNull();
    // Tampering breaks the signature.
    const [body, sig] = token!.split(".");
    const forged = Buffer.from(JSON.stringify({ d: DATE, n: "Trainer1", m: 0, t: 1, h: false })).toString("base64url");
    expect(readBeatToken(`${forged}.${sig}`)).toBeNull();
    expect(readBeatToken(`${body}x.${sig}`)).toBeNull();
    expect(readBeatToken(undefined)).toBeNull();
    expect(beatPath(token!)).toBe(`/connections?beat=${encodeURIComponent(token!)}`);
  });

  it("the route reads a valid token and refuses a bad one", async () => {
    const board = memoryConnBoard();
    await board.record(entry(1, 0, 40_000));
    const token = (await beatToken(DATE, connPlayerKey(`u:${user(1)}`), board))!;
    const ok = await getBeat(new NextRequest(`http://x/api/connections/beat?token=${encodeURIComponent(token)}`));
    expect(await ok.json()).toMatchObject({ name: "Trainer1", mistakes: 0, ms: 40_000 });
    expect((await getBeat(new NextRequest("http://x/api/connections/beat?token=abc.def"))).status).toBe(404);
  });
});

describe("creator boosts", () => {
  const ids = (names: string[]) => names.map((n) => FACTS.find((f) => f.name === n)!.id);
  const groups = () => [
    { name: "Sleepy and lazy", level: 0 as const, members: ids(["Snorlax", "Psyduck", "Slowpoke", "Drowzee"]) },
    { name: "Pays attention", level: 1 as const, members: ids(["Meowth", "Abra", "Pikachu", "Eevee"]) },
    { name: "Rocky road", level: 2 as const, members: ids(["Onix", "Geodude", "Machop", "Zubat"]) },
    { name: "Odd ones out", level: 3 as const, members: ids(["Ditto", "Mewtwo", "Lugia", "Magikarp"]) },
  ];
  const publish = async (store: ReturnType<typeof memoryCustomStore>, who: string, name: string, votes: number) => {
    const out = await publishCustom({ identity: `d:${who}`, creatorName: name, title: `By ${name}`, groups: groups() }, store, T);
    if (!out.ok) throw new Error(out.error);
    for (let i = 0; i < votes; i++) await voteCustom(out.id, `d:voter-${who}-${i}-xxxxxxxx`, 1, store);
    return out.id;
  };

  it("picks the top-voted recent puzzle that wasn't picked lately", () => {
    const mk = (id: string, up: number, down: number, days = 1): StoredCustom => ({ id, creatorKey: `k-${id}`.padEnd(16, "x"), creatorName: id, title: id, groups: [], tiles: [], up, down, createdAt: new Date(T - days * 86_400_000).toISOString() });
    const list = [mk("aaaaaaaa", 3, 0), mk("bbbbbbbb", 9, 1), mk("cccccccc", 5, 5), mk("dddddddd", 8, 0)];
    expect(pickPotd(list, new Set())?.id).toBe("bbbbbbbb");
    expect(pickPotd(list, new Set(["bbbbbbbb"]))?.id).toBe("dddddddd");
    expect(pickPotd([mk("cccccccc", 5, 5)], new Set())).toBeNull(); // no net votes, no pick
  });

  it("the Puzzle of the Day holds for the day, and carries no answers", async () => {
    const custom = memoryCustomStore();
    const social = memorySocialStore();
    const low = await publish(custom, "low", "LowVotes", 1);
    const top = await publish(custom, "top", "TopVotes", 3);
    const first = await puzzleOfTheDay(T, custom, social);
    expect(first.puzzle).toMatchObject({ id: top, creator: "TopVotes", up: 3 });
    for (const w of ["Snorlax", "Sleepy and lazy", "Odd ones out"]) expect(JSON.stringify(first)).not.toContain(w);
    for (let i = 0; i < 5; i++) await voteCustom(low, `d:late-voter-${i}-xxxxxxxxxx`, 1, custom);
    expect((await puzzleOfTheDay(T + 3_600_000, custom, social)).puzzle?.id).toBe(top); // not flipped by later votes
    expect((await puzzleOfTheDay(T + 86_400_000, custom, social)).puzzle?.id).toBe(low); // tomorrow: not the same one again
    expect(await puzzleOfTheDay(T, null, social)).toEqual({ available: false, puzzle: null });
  });

  it("marks a creator as featured when their puzzle is the week's best or was picked", async () => {
    const custom = memoryCustomStore();
    const social = memorySocialStore();
    await publish(custom, "star", "Star", 2);
    await publish(custom, "other", "Other", 0);
    expect(await isFeaturedCreator(connPlayerKey("d:star"), T, custom, social)).toBe(true); // best of the week
    expect(await isFeaturedCreator(connPlayerKey("d:other"), T, custom, social)).toBe(false);
    expect(await isFeaturedCreator(connPlayerKey("d:nobody"), T, null, social)).toBe(false);
    await puzzleOfTheDay(T, custom, social);
    expect(await isFeaturedCreator(connPlayerKey("d:star"), T + 40 * 86_400_000, custom, social)).toBe(true); // was Puzzle of the Day once
  });

  it("builds a creator's page: their puzzles and total votes", async () => {
    const custom = memoryCustomStore();
    await publish(custom, "c1", "Brock", 2);
    await publish(custom, "c1", "Brock", 1);
    await publish(custom, "c2", "Misty", 5);
    const page = await creatorPage("brock", custom);
    expect(page).toMatchObject({ name: "Brock", votes: 3, score: 3 });
    expect(page?.puzzles).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain("Snorlax");
    expect(await creatorPage("Nobody", custom)).toBeNull();
    expect(await creatorPage("<script>", custom)).toBeNull();
    expect(creatorPath("Ash Ketchum")).toBe("/connections/creator/Ash%20Ketchum");
  });
});

describe("the Featured creator badge and the hint on the share card", () => {
  it("is awarded once, from the existing badge list", async () => {
    const ls = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) });
    const prog = await import("@/lib/progress");
    expect(prog.BADGES.some((x) => x.id === "conn-featured" && x.name === "Featured creator")).toBe(true);
    expect(prog.awardFeaturedCreator().map((x) => x.id)).toEqual(["conn-featured"]);
    expect(prog.awardFeaturedCreator()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("marks a hinted game on the share link and text, and only then", async () => {
    const base = { game: "connections" as const, daily: 4, solved: true, rows: ["0000", "1111", "2222", "3333"] };
    const { connectionsShareText } = await import("@/lib/share");
    expect(connectionsShareText({ ...base, hinted: true })).toContain("💡hint");
    expect(connectionsShareText(base)).not.toContain("hint");
    expect(decodeShare(encodeShare({ ...base, hinted: true }))).toMatchObject({ hinted: true });
    expect(decodeShare(encodeShare(base))).not.toHaveProperty("hinted");
  });
});

describe("answer safety", () => {
  it("colours and levels are all the report and hint ever name", () => {
    expect(CONN_LEVELS.map((l) => l.name)).toEqual(["Yellow", "Green", "Blue", "Purple", "Red"]);
  });
});
