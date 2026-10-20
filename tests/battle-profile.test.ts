import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actOnBattle, battleToken, createLiveBattle, createMatchedBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { saveReplayFor, settleBattle } from "@/lib/server/battle-engine/settle";
import { battleProfile, clearMemoryRecords, resultsOf } from "@/lib/server/battle-engine/records";
import { clearMemoryLadder } from "@/lib/server/battle-engine/ladder";
import { clearMemoryReplays } from "@/lib/server/battle-engine/replays";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const RED = "profileredprofilered";
const BLUE = "profileblueprofileblu";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 12, 0, 0));
  clearMemoryRecords();
  clearMemoryLadder();
  clearMemoryReplays();
});
afterEach(() => vi.useRealTimers());

async function forfeitBy(code: string, token: string) {
  const seat = readBattleToken(token, code)!;
  await actOnBattle(code, seat.playerId, { action: "forfeit" }, 0);
}

describe("battle records", () => {
  it("count each trainer's live battles per format, with links to saved replays", async () => {
    const made = (await createMatchedBattle("gen9randombattle", [
      { name: "Red", player: RED },
      { name: "Blue", player: BLUE },
    ]))!;
    await forfeitBy(made.code, battleToken(made.code, made.ids[1], 1));
    await settleBattle(made.code);
    await settleBattle(made.code);

    const friend = await createLiveBattle({ name: "Red", format: "gen9ou", player: RED, team: undefined }, Date.now()).catch(() => null);
    expect(friend?.ok).toBe(false); // OU needs a team: no battle, no record

    vi.setSystemTime(Date.UTC(2026, 9, 20, 12, 5, 0));
    const doubles = (await createMatchedBattle("gen9randomdoublesbattle", [
      { name: "Blue", player: BLUE },
      { name: "Red", player: RED },
    ]))!;
    await forfeitBy(doubles.code, battleToken(doubles.code, doubles.ids[1], 1));
    await settleBattle(doubles.code);

    const red = (await battleProfile(RED))!;
    expect(red.formats.map((f) => [f.format, f.wins, f.losses]).sort()).toEqual([
      ["gen9randombattle", 1, 0],
      ["gen9randomdoublesbattle", 0, 1],
    ]);
    expect(red.recent.map((r) => [r.code, r.result, r.opponent])).toEqual([
      [doubles.code, "loss", "Blue"],
      [made.code, "win", "Blue"],
    ]);
    // Matchmade battles are public: their replays were saved, and the record links them.
    expect(red.recent.every((r) => r.replay)).toBe(true);
    const blue = (await battleProfile(BLUE))!;
    expect(blue.formats.find((f) => f.format === "gen9randombattle")).toMatchObject({ wins: 0, losses: 1 });
    // Nothing secret in a profile.
    expect(JSON.stringify(red)).not.toContain(BLUE);
  });

  it("links a private battle's replay once a trainer saves it", async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9randombattle", player: RED }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue", player: BLUE }, 0);
    if (!joined.ok) throw new Error(joined.error);
    const red = readBattleToken(made.token, made.code)!;
    await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
    await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
    await forfeitBy(made.code, made.token);
    await settleBattle(made.code);
    expect((await battleProfile(BLUE))!.recent[0]).toMatchObject({ code: made.code, result: "win", replay: false });
    // A forfeit on turn 1 still has a log to watch.
    const saved = await saveReplayFor(made.code, red.playerId);
    expect(saved.ok).toBe(true);
    expect((await battleProfile(BLUE))!.recent[0].replay).toBe(true);
  });

  it("skip trainers the server doesn't know, and battles with no contest", async () => {
    const made = (await createMatchedBattle("gen9randombattle", [{ name: "Red", player: RED }, { name: "Anon" }]))!;
    await forfeitBy(made.code, battleToken(made.code, made.ids[1], 1));
    const meta = (await loadBattle(made.code))!.rec.meta;
    expect(resultsOf(meta, undefined, 0).map((r) => r.key)).toEqual([RED]);
    expect(resultsOf({ ...meta, end: { reason: "nocontest", winner: null, at: 0 } }, undefined, 0)).toEqual([]);
    expect(resultsOf({ ...meta, kind: "cpu" }, undefined, 0)).toEqual([]);
  });
});
