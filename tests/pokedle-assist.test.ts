import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as dexGET } from "@/app/api/pokedle/dex/route";
import { POST as guessPOST } from "@/app/api/pokedle/route";
import { POST as resultPOST } from "@/app/api/pokedle/result/route";
import { DLE_ASSISTS, DLE_ASSIST_INFO, dleAssistOf, withAssist, type DleAssist } from "@/lib/dle-assist";
import { dleBasePoints, dleScore, type DleDexRow, type DleResponse } from "@/lib/dle-types";
import { buildPokedleShare } from "@/lib/dle-share";
import { dexFullTraits } from "@/lib/dle-dex";
import type { DleResultResponse } from "@/lib/dle-community";
import { answerFor, evaluate, traitsOf } from "@/lib/server/pokedle";
import { clearMemoryResults, dailyPuzzle, memoryResultStore, recordDleResult, supabaseResultStore } from "@/lib/server/dle-results";
import { createPokedleDuel, pokedleRules, pokedleView, setPokedleAssist, type PokedleDuel } from "@/lib/server/pokedle-duel";
import { joinDuel, readyDuel, rematchOf } from "@/lib/server/duels";
import { matchSettingsSchema, newTicket, queueKey, searchMatch, type MatchSettings, type SearchResult } from "@/lib/server/matchmaking";
import { RANKED_QUEUE_KEY } from "@/lib/server/ranked-queue";
import { pvpStore, queueStore } from "@/lib/server/duel-store";
import { readPvpToken, type PvpFailure, type PvpOutcome } from "@/lib/server/duel-core";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { isValidDailyDate } from "@/lib/daily";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const dex = (assist?: string) => dexGET(new Request(`http://localhost/api/pokedle/dex${assist ? `?assist=${assist}` : ""}`));
const rowsAt = async (assist?: string) => (await dex(assist).json()) as DleDexRow[];
const COLOURS = /"(black|blue|brown|gray|green|pink|purple|red|white|yellow)"/;

describe("the Pokédex API sends only what the assist level shows", () => {
  it("Notebook (and a missing or unknown level): id, name, generation and types only", async () => {
    for (const level of [undefined, "notebook", "everything", "OFF2"]) {
      const res = dex(level);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.match(/\[143,[^\]]*\]/)![0]).toBe(JSON.stringify([143, "Snorlax", 1, "normal", null]));
      expect(text).not.toMatch(COLOURS);
      for (const row of JSON.parse(text) as DleDexRow[]) expect(row).toHaveLength(5);
    }
  });

  it("Field Guide: adds stage and colour, never height or weight", async () => {
    const rows = await rowsAt("field");
    expect(rows.map((r) => r[0])).toEqual(POKEDEX.map((p) => p.id));
    for (const row of rows) {
      expect(row).toHaveLength(7);
      const t = traitsOf(getPokemon(row[0])!);
      expect(row.slice(2)).toEqual([t.gen, t.type1, t.type2, t.stage, t.color]);
      expect(dexFullTraits(row)).toBeNull();
    }
    const snorlax = getPokemon(143)!;
    expect(rows.find((r) => r[0] === 143)).toEqual([143, "Snorlax", 1, "normal", null, traitsOf(snorlax).stage, snorlax.color]);
  });

  it("Full Pokédex: adds height and weight too, enough to read every clue", async () => {
    const rows = await rowsAt("full");
    for (const row of rows) {
      expect(row).toHaveLength(9);
      expect(dexFullTraits(row)).toEqual(traitsOf(getPokemon(row[0])!));
    }
  });

  it("Off: no Pokédex at all", async () => {
    const res = dex("off");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Snorlax");
  });

  it("is the same list whatever the puzzle, cached per level", async () => {
    expect(await dex("full").text()).toBe(await dex("full").text());
    expect(dex("field").headers.get("cache-control")).toMatch(/public/);
  });
});

describe("assist levels and points", () => {
  it("lighter assist is worth more, with the Notebook unchanged", () => {
    const m = DLE_ASSISTS.map((a) => DLE_ASSIST_INFO[a].multiplier);
    expect(m).toEqual([...m].sort((a, b) => b - a));
    expect(DLE_ASSIST_INFO.notebook.multiplier).toBe(1);
    for (const guesses of [1, 4, 8]) {
      const points = DLE_ASSISTS.map((a) => dleScore(guesses, true, [], a));
      expect(points).toEqual([...points].sort((a, b) => b - a));
      expect(dleScore(guesses, true, [])).toBe(dleBasePoints(guesses));
    }
    expect(dleScore(3, true, [], "off")).toBe(Math.round(dleBasePoints(3) * 1.25));
    expect(dleScore(3, true, [], "full")).toBe(Math.round(dleBasePoints(3) * 0.7));
    // After hint costs, and never below 0.
    expect(dleScore(2, true, ["genus"], "field")).toBe(withAssist(dleBasePoints(2) - 150, "field"));
    expect(dleScore(8, false, ["genus", "silhouette"], "off")).toBe(0);
  });

  it("reads unknown levels as the Notebook", () => {
    expect(dleAssistOf(undefined)).toBe("notebook");
    expect(dleAssistOf("nope")).toBe("notebook");
    expect(dleAssistOf("full")).toBe("full");
  });

  it("scores a finished game on the server at the level it was played at", async () => {
    const puzzle = { id: "practice:assist-a" };
    const answer = answerFor(puzzle).id;
    const miss = answer === 25 ? 26 : 25;
    expect(evaluate(puzzle, [miss]).score).toBeUndefined();
    for (const assist of DLE_ASSISTS) expect(evaluate(puzzle, [miss, answer], [], assist).score).toBe(dleScore(2, true, [], assist));

    const res = await guessPOST(
      new NextRequest("http://localhost/api/pokedle", { method: "POST", body: JSON.stringify({ practiceSeed: "assist-a", guesses: [miss, answer], assist: "off" }) })
    );
    expect(((await res.json()) as DleResponse).score).toBe(dleScore(2, true, [], "off"));
    const bad = await guessPOST(
      new NextRequest("http://localhost/api/pokedle", { method: "POST", body: JSON.stringify({ practiceSeed: "assist-a", guesses: [miss], assist: "max" }) })
    );
    expect(bad.status).toBe(400);
  });

  it("marks the level in the share text", () => {
    const base = { number: 7, rows: [["match", "match", "match", "match", "match", "match", "match"] as const].map((r) => [...r]), solved: true, hard: false, hints: [], streak: 0, url: "https://pokeiq.app/pokedle" };
    expect(buildPokedleShare(base).split("\n")[0]).toBe("Pokédle #7 1/8");
    for (const assist of DLE_ASSISTS) expect(buildPokedleShare({ ...base, assist }).split("\n")[0]).toBe(`Pokédle #7 1/8 ${DLE_ASSIST_INFO[assist].emoji}`);
  });
});

describe("daily results keep the level", () => {
  const NOW = Date.parse("2026-10-19T12:00:00Z");
  const DAY = "2026-10-19";
  const answer = () => answerFor(dailyPuzzle(DAY)).id;
  beforeEach(() => clearMemoryResults());

  it("records the level and its points, and a later claim at another level gets the first", async () => {
    const store = memoryResultStore();
    const guesses = [answer() === 1 ? 2 : 1, answer()];
    const full = await recordDleResult({ date: DAY, identity: "d:assist-full-0001", guesses, assist: "full" }, store, NOW);
    expect(full).toMatchObject({ ok: true, you: { recorded: true, assist: "full", score: dleScore(2, true, [], "full") } });
    const again = await recordDleResult({ date: DAY, identity: "d:assist-full-0001", guesses, assist: "notebook" }, store, NOW);
    expect(again).toMatchObject({ ok: true, you: { recorded: false, assist: "full", score: dleScore(2, true, [], "full") } });
    // No level sent: the Notebook.
    const old = await recordDleResult({ date: DAY, identity: "d:assist-none-0002", guesses, hints: ["genus"] }, store, NOW);
    expect(old).toMatchObject({ ok: true, you: { assist: "notebook", score: dleScore(2, true, ["genus"]) } });
  });

  it("sends the level to the database, and still records without it before migration 0015", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60 * 60_000); // past any pause from other tests
    const kept = { recorded: true, guesses: 2, solved: true, first_guess: 1, position: 1, rank: 1, same_opener: 1 };
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) =>
      "p_assist" in args ? { data: null, error: { code: "PGRST202", message: "no function with p_assist" } } : { data: kept, error: null }
    );
    const db = supabaseResultStore({ rpc } as unknown as SupabaseClient);
    const out = await recordDleResult({ date: DAY, identity: "d:assist-db-00003", guesses: [answer() === 1 ? 2 : 1, answer()], assist: "off" }, db, NOW);
    expect(out).toMatchObject({ ok: true, you: { recorded: true, assist: "off", score: dleScore(2, true, [], "off") } });
    expect(rpc).toHaveBeenNthCalledWith(1, "dle_record_result", expect.objectContaining({ p_assist: "off", p_score: dleScore(2, true, [], "off") }));
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_assist");

    // With 0015: the row kept says which level, whatever this request claims.
    vi.setSystemTime(Date.now() + 2 * 60_000);
    const rpc2 = vi.fn(async () => ({ data: { ...kept, recorded: false, assist: "full", score: 560 }, error: null }));
    const db2 = supabaseResultStore({ rpc: rpc2 } as unknown as SupabaseClient);
    const claim = await recordDleResult({ date: DAY, identity: "d:assist-db-00003", guesses: [answer()], assist: "off" }, db2, NOW);
    expect(claim).toMatchObject({ ok: true, you: { recorded: false, assist: "full", score: 560 } });
    vi.useRealTimers();
  });

  it("takes the level through POST /api/pokedle/result", async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isValidDailyDate(today)).toBe(true);
    const id = answerFor(dailyPuzzle(today)).id;
    const res = await resultPOST(
      new NextRequest("http://localhost/api/pokedle/result", {
        method: "POST",
        headers: { "x-forwarded-for": "10.9.8.7" },
        body: JSON.stringify({ date: today, player: "assist-route-player-01", guesses: [id], assist: "field" }),
      })
    );
    const body = (await res.json()) as DleResultResponse;
    expect(body).toMatchObject({ available: true, you: { assist: "field", score: dleScore(1, true, [], "field") } });
  });
});

describe("duels and matchmaking share one level", () => {
  const T0 = 1_800_000_000_000;
  const must = <T extends PokedleDuel>(out: PvpOutcome<T> | PvpFailure): T => {
    if (!out.ok) throw new Error(out.error);
    return out.duel;
  };
  afterEach(() => vi.useRealTimers());

  it("the host picks the level in the lobby; both see it", () => {
    const { duel, playerId: host } = createPokedleDuel("Red", "asst0001", T0);
    expect(pokedleView(duel, host, T0, 0).assist).toBe("notebook");
    const joined = must(joinDuel(duel, "Blue", T0));
    const guest = joined.players[1].id;
    const ready = must(readyDuel(joined, guest, true, T0));

    const changed = must(setPokedleAssist(ready, host, "full", T0));
    expect(changed.assist).toBe("full");
    expect(changed.players.every((p) => !p.ready)).toBe(true);
    expect(pokedleView(changed, guest, T0, 1).assist).toBe("full");
    expect(pokedleView(changed, host, T0, 1).assist).toBe("full");

    const refused = setPokedleAssist(changed, guest, "off", T0);
    expect(refused.ok).toBe(false);
    expect(must(setPokedleAssist(changed, host, "notebook", T0)).assist).toBeUndefined();
  });

  it("a friend's duel can start at a level, a rematch keeps it, and it's fixed once the duel starts", () => {
    const { duel, playerId: host } = createPokedleDuel("Red", "asst0002", T0, undefined, { assist: "field" });
    expect(duel.assist).toBe("field");
    let d = must(joinDuel(duel, "Blue", T0));
    d = must(readyDuel(d, host, true, T0));
    d = must(readyDuel(d, d.players[1].id, true, T0));
    expect(d.status).toBe("playing");
    expect(setPokedleAssist(d, host, "off", T0).ok).toBe(false);
    expect((pokedleRules.blank(d, d) as PokedleDuel).assist).toBe("field");
    expect((rematchOf({ ...d, status: "finished" }, "asst0003", T0) as PokedleDuel).assist).toBe("field");
  });

  it("ranked is always the Notebook", () => {
    const ranked = { keys: ["a", "b"] as [string, string], ratings: [1000, 1000] as [number, number], games: [0, 0] as [number, number] };
    const { duel, playerId } = createPokedleDuel("Red", "asst0004", T0, undefined, { queue: "ranked", ranked, assist: "full" });
    expect(duel.assist).toBeUndefined();
    expect(pokedleView(duel, playerId, T0, 0).assist).toBe("notebook");
    expect(setPokedleAssist(duel, playerId, "off", T0).ok).toBe(false);
  });

  it("each level has its own casual queue; ranked has one", () => {
    const keys = DLE_ASSISTS.map((assist) => queueKey({ game: "pokedle", assist }));
    expect(new Set(keys).size).toBe(DLE_ASSISTS.length);
    // The Notebook keeps the queue there was before levels.
    expect(queueKey({ game: "pokedle" })).toBe("pokedle:all");
    expect(queueKey({ game: "pokedle", assist: "notebook" })).toBe("pokedle:all");
    for (const assist of DLE_ASSISTS) expect(queueKey({ game: "pokedle", ranked: true, assist })).toBe(RANKED_QUEUE_KEY);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9:-]{3,64}$/);
    expect(matchSettingsSchema.safeParse({ game: "pokedle", assist: "max" }).success).toBe(false);
  });

  it("pairs only searchers on the same level, into a duel at that level", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const levels: DleAssist[] = ["full", "off"];
    const settings = (assist: DleAssist): MatchSettings => ({ game: "pokedle", assist });
    for (const a of levels) await queueStore.remove(queueKey(settings(a)));
    const matched = (out: SearchResult | PvpFailure) => {
      if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
      return out;
    };

    const red = newTicket();
    expect(await searchMatch(settings("full"), "Red", red)).toMatchObject({ ok: true, status: "waiting" });
    // Someone on another level waits in their own queue.
    expect(await searchMatch(settings("off"), "Green", newTicket())).toMatchObject({ ok: true, status: "waiting" });
    const blue = matched(await searchMatch(settings("full"), "Blue", newTicket()));
    const duel = (await pvpStore.load(blue.code))!.duel as PokedleDuel;
    expect(duel.assist).toBe("full");
    expect(duel.queue).toBe("casual");
    const seat = readPvpToken(blue.token, blue.code)!;
    expect(pokedleView(duel, seat, T0, 0).assist).toBe("full");
    for (const a of levels) await queueStore.remove(queueKey(settings(a)));
  });
});
