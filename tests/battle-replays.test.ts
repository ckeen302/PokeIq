import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actOnBattle,
  battleToken,
  createCpuBattle,
  createLiveBattle,
  createMatchedBattle,
  pollBattle,
  readBattleToken,
} from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { settleBattle, saveReplayFor } from "@/lib/server/battle-engine/settle";
import { clearMemoryReplays, memoryReplayStore, replayFromRecord } from "@/lib/server/battle-engine/replays";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { lastTurn, linesThrough, replayResult, turnStarts } from "@/lib/battle/replay";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 12, 0, 0));
  clearMemoryReplays();
});
afterEach(() => vi.useRealTimers());

const store = { get: (id: string) => memoryReplayStore().get(id), recent: (f: string | null, n: number) => memoryReplayStore().recent(f, n), mine: (k: string | null, ids: string[], n: number) => memoryReplayStore().mine(k, ids, n) };

/** Both trainers play `turns` turns, then the second forfeits. */
async function finish(code: string, tokens: string[], turns = 3) {
  for (let i = 0; i < turns * 3; i++) {
    for (const token of tokens) {
      const out = await pollBattle(code, token, 0);
      if (!out.ok) throw new Error(out.error);
      const view = out.view;
      if (view.status !== "playing" || !view.request || view.waiting) continue;
      const seat = readBattleToken(token, code)!;
      await actOnBattle(code, seat.playerId, { action: "choose", rqid: view.request.rqid, choice: firstChoice(view.request.data, false) }, 0);
    }
    if ((await loadBattle(code))!.rec.meta.turn > turns) break;
  }
  const blue = readBattleToken(tokens[1], code)!;
  await actOnBattle(code, blue.playerId, { action: "forfeit" }, 0);
}

async function matched(players: [string, string] = ["kkkkkkkkkkkkkkkkkkkkkk", "llllllllllllllllllllll"]) {
  const made = await createMatchedBattle("gen9randombattle", [
    { name: "Red", player: players[0] },
    { name: "Blue", player: players[1] },
  ]);
  if (!made) throw new Error("no battle");
  return { code: made.code, tokens: [battleToken(made.code, made.ids[0], 0), battleToken(made.code, made.ids[1], 1)] };
}

describe("replays", () => {
  it("store the spectator channel only, and are saved on their own for public battles", async () => {
    const { code, tokens } = await matched();
    await finish(code, tokens);
    await settleBattle(code);
    const rec = (await loadBattle(code))!.rec;
    expect(rec.meta.settled).toBeTruthy();
    expect(rec.meta.replay).toBe(code);
    const replay = (await store.get(code))!;
    expect(replay).toMatchObject({ id: code, players: ["Red", "Blue"], winner: 0, reason: "forfeit", public: true, ranked: false, format: "gen9randombattle" });
    // Exactly the spectator channel: nothing from a player's own channel, no request, no seed.
    expect(replay.log).toEqual(rec.logs.spectator);
    const json = JSON.stringify(replay);
    const privateOnly = [...rec.logs.p1, ...rec.logs.p2].filter((l) => !rec.logs.spectator.includes(l));
    expect(privateOnly.length).toBeGreaterThan(0);
    for (const line of privateOnly) expect(json).not.toContain(line);
    expect(json).not.toContain(rec.meta.seed);
    expect(json).not.toMatch(/\|request\||\|split\||"keys"|kkkkkkkk|"inputLog"|"state"/);
    for (const line of replay.log) {
      const hp = /^\|(?:switch|drag|-damage|-heal)\|[^|]+\|(?:[^|]+\|)?\d+\/(\d+)/.exec(line);
      if (hp) expect(hp[1]).toBe("100");
    }
    // Listed, and found by either trainer's key.
    expect((await store.recent(null, 10)).map((r) => r.id)).toEqual([code]);
    const mine = await store.mine("llllllllllllllllllllll", [], 10);
    expect(mine.map((r) => r.id)).toEqual([code]);
    expect(Object.keys(mine[0])).not.toContain("log");
    expect(Object.keys(mine[0])).not.toContain("keys");
    // Settling again changes nothing.
    await settleBattle(code);
    expect((await store.recent(null, 10)).length).toBe(1);
  });

  it("a private friend battle is only saved when a trainer asks, and stays unlisted", async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9randombattle" }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
    if (!joined.ok) throw new Error(joined.error);
    const red = readBattleToken(made.token, made.code)!;
    await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
    await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
    const tokens = [made.token, battleToken(made.code, joined.playerId, 1)];
    expect((await saveReplayFor(made.code, red.playerId)).ok).toBe(false);
    await finish(made.code, tokens);
    await settleBattle(made.code);
    expect(await store.get(made.code)).toBeNull();
    // Nobody else can save it.
    const stranger = await saveReplayFor(made.code, "someone-else");
    expect(stranger.ok || stranger.status).toBe(403);
    const saved = await saveReplayFor(made.code, joined.playerId);
    expect(saved).toEqual({ ok: true, id: made.code });
    const replay = (await store.get(made.code))!;
    expect(replay.public).toBe(false);
    expect(replay.log).toEqual((await loadBattle(made.code))!.rec.logs.spectator);
    expect((await store.recent(null, 10)).map((r) => r.id)).not.toContain(made.code);
    // The device that saved it lists it by id.
    expect((await store.mine(null, [made.code], 10)).map((r) => r.id)).toEqual([made.code]);
    // Saving twice is the same replay.
    expect(await saveReplayFor(made.code, red.playerId)).toEqual({ ok: true, id: made.code });
  });

  it("a battle against the computer can be saved, unlisted", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const me = readBattleToken(made.token, made.code)!;
    const req = made.view.request!;
    await actOnBattle(made.code, me.playerId, { action: "choose", rqid: req.rqid, choice: firstChoice(req.data, false) }, 0);
    await actOnBattle(made.code, me.playerId, { action: "forfeit" }, 0);
    const out = await saveReplayFor(made.code, me.playerId);
    expect(out.ok).toBe(true);
    const replay = (await store.get(made.code))!;
    expect(replay.public).toBe(false);
    expect(replay.players).toEqual(["Red", "CPU"]);
    expect(replay.log).toEqual((await loadBattle(made.code))!.rec.logs.spectator);
  });

  it("replayFromRecord never reads a player's channel", async () => {
    const { code, tokens } = await matched();
    await finish(code, tokens, 1);
    const rec = (await loadBattle(code))!.rec;
    const poisoned = { ...rec, logs: { ...rec.logs, p1: ["|secret|p1"], p2: ["|secret|p2"] } };
    expect(replayFromRecord(poisoned, true).log).toEqual(rec.logs.spectator);
  });
});

describe("replay turns", () => {
  const log = ["|player|p1|Red", "|start", "|switch|p1a: A|A|100/100", "|turn|1", "|move|p1a: A|Tackle|p2a: B", "|turn|2", "|move|p1a: A|Tackle|p2a: B", "|win|Red"];
  it("finds where each turn starts", () => {
    expect(turnStarts(log)).toEqual([0, 3, 5]);
    expect(lastTurn(log)).toBe(2);
    expect(linesThrough(log, 1)).toEqual(log.slice(0, 4));
    expect(linesThrough(log, 2)).toEqual(log.slice(0, 6));
    expect(linesThrough(log, 3)).toEqual(log);
    expect(replayResult({ players: ["Red", "Blue"], winner: 1 })).toBe("Blue beat Red");
    expect(replayResult({ players: ["Red", "Blue"], winner: null })).toBe("Red and Blue drew");
  });
});
