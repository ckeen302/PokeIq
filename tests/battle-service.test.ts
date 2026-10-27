import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actOnBattle,
  createCpuBattle,
  createLiveBattle,
  pollBattle,
  readBattleToken,
  rematchBattle,
  updateBattle,
} from "@/lib/server/battle-engine/service";
import { loadBattle, saveBattle } from "@/lib/server/battle-engine/store";
import * as store from "@/lib/server/battle-engine/store";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { SIM_VERSION } from "@/lib/server/battle-engine/engine";
import { BATTLE_TIMER, type BattleView } from "@/lib/battle/play";

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (ms: number) => vi.setSystemTime(T0 + ms);

async function choose(code: string, token: string, view: BattleView) {
  const seat = readBattleToken(token, code)!;
  const req = view.request!;
  const out = await actOnBattle(code, seat.playerId, { action: "choose", rqid: req.rqid, choice: firstChoice(req.data, view.format === "gen9randomdoublesbattle") }, view.log.total);
  if (!out.ok) throw new Error(`${out.status} ${out.error}`);
  return out.view;
}

async function poll(code: string, token: string | null, since = 0) {
  const out = await pollBattle(code, token, since);
  if (!out.ok) throw new Error(`${out.status} ${out.error}`);
  return out.view;
}

/** A live battle with both players seated and ready: [code, red's token, blue's token]. */
async function liveBattle(format: "gen9randombattle" | "gen9randomdoublesbattle" = "gen9randombattle") {
  const made = await createLiveBattle({ name: "Red", format }, Date.now());
  if (!made.ok) throw new Error(made.error);
  const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
  if (!joined.ok) throw new Error(joined.error);
  const red = readBattleToken(made.token, made.code)!;
  expect((await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0)).ok).toBe(true);
  const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
  if (!started.ok) throw new Error(started.error);
  expect(started.view.status).toBe("playing");
  const { battleToken } = await import("@/lib/server/battle-engine/service");
  return { code: made.code, red: made.token, blue: battleToken(made.code, joined.playerId, 1) };
}

describe("battles against the computer", () => {
  it("plays turns: the computer answers at once, explicitly", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "normal" });
    if (!made.ok) throw new Error(made.error);
    let view = made.view;
    expect(view.status).toBe("playing");
    expect(view.you).toBe(0);
    expect(view.request?.data.side.id).toBe("p1");
    let lines = [...view.log.lines];
    for (let i = 0; i < 40 && view.status === "playing"; i++) {
      expect(view.request, "the player always has a request between turns").not.toBeNull();
      view = await choose(made.code, made.token, view);
      expect(view.log.from).toBe(lines.length);
      lines = [...lines, ...view.log.lines];
    }
    expect(lines.some((l) => l.startsWith("|move|p2a:"))).toBe(true);
    expect(view.turn).toBeGreaterThan(3);
    // The input log has explicit choices only (no "default").
    const stored = await loadBattle(made.code);
    expect(stored!.rec.inputLog.some((l) => /default/.test(l))).toBe(false);
  });

  it("starts a turn from the record it remembers, and from the store once another instance moved on", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const seat = readBattleToken(made.token, made.code)!;
    // Remembered from the insert: the first turn needs no read (the store is spied on).
    const loads = vi.spyOn(store, "loadBattle");
    const first = await choose(made.code, made.token, made.view);
    expect(loads).not.toHaveBeenCalled();
    expect(first.turn).toBe(2);
    // Another instance (a direct save) changes the record behind this one's back: a forfeit.
    const stored = (await store.loadBattle(made.code))!;
    const meta = structuredClone(stored.rec.meta);
    meta.status = "finished";
    meta.end = { at: Date.now(), winner: 1, reason: "forfeit" };
    expect(await saveBattle(made.code, stored.version, { meta })).toBe(true);
    // The remembered copy is stale: the compare-and-swap fails, the store is read, and the choice is refused.
    const out = await actOnBattle(made.code, seat.playerId, { action: "choose", rqid: first.request!.rqid, choice: "move 1" }, first.log.total);
    expect(loads).toHaveBeenCalled();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(409);
    loads.mockRestore();
  });

  it("rejects stale and duplicate choices", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const me = readBattleToken(made.token, made.code)!;
    const req = made.view.request!;
    const choice = firstChoice(req.data, false);
    const stale = await actOnBattle(made.code, me.playerId, { action: "choose", rqid: req.rqid - 1, choice }, 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    const first = await actOnBattle(made.code, me.playerId, { action: "choose", rqid: req.rqid, choice }, 0);
    expect(first.ok).toBe(true);
    const again = await actOnBattle(made.code, me.playerId, { action: "choose", rqid: req.rqid, choice }, 0);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
    // Only one turn was played.
    const stored = await loadBattle(made.code);
    expect(stored!.rec.inputLog.filter((l) => l.startsWith(">p1 ")).length).toBe(1);
  });

  it("an illegal choice comes back with the simulator's reason and changes nothing", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const me = readBattleToken(made.token, made.code)!;
    const out = await actOnBattle(made.code, me.playerId, { action: "choose", rqid: made.view.request!.rqid, choice: "move 9" }, 0);
    expect(out.ok && out.rejected).toBeTruthy();
    const stored = await loadBattle(made.code);
    expect(stored!.rec.meta.turn).toBe(1);
  });

  it("never sends the seed, the state, the input log or the computer's team", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "hard" });
    if (!made.ok) throw new Error(made.error);
    const view = await choose(made.code, made.token, made.view);
    const stored = (await loadBattle(made.code))!.rec;
    const json = JSON.stringify([made, view, await poll(made.code, made.token)]);
    expect(json).not.toContain(stored.meta.seed);
    expect(json).not.toContain(stored.meta.seats[1].team!.slice(0, 40));
    expect(json).not.toMatch(/inputLog|"state"|"seed"|\|request\|/);
    // The computer's request never reaches the player.
    expect(json).not.toContain('"id":"p2"');
    // A visitor sees no log and no request.
    const visitor = await poll(made.code, null);
    expect(visitor.you).toBeNull();
    expect(visitor.log.lines).toEqual([]);
    expect(visitor.request).toBeNull();
  });

  it("brings an OU team; the computer brings an OU team too", async () => {
    const team = `Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance`;
    const missing = await createCpuBattle({ name: "Red", format: "gen9ou", level: "normal" });
    expect(missing.ok).toBe(false);
    const made = await createCpuBattle({ name: "Red", format: "gen9ou", level: "normal", team });
    if (!made.ok) throw new Error(made.error);
    // Team preview: choose a lead.
    expect(made.view.request?.data.teamPreview).toBe(true);
    expect(made.view.log.lines.filter((l) => l.startsWith("|poke|p2|"))).toHaveLength(6);
    const view = await choose(made.code, made.token, made.view);
    expect(view.log.lines.some((l) => l.startsWith("|switch|p1a: Kingambit"))).toBe(true);
  });

  it("random doubles works, targets and all", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randomdoublesbattle", level: "hard" });
    if (!made.ok) throw new Error(made.error);
    let view = made.view;
    for (let i = 0; i < 25 && view.status === "playing"; i++) view = await choose(made.code, made.token, view);
    expect(view.turn).toBeGreaterThan(3);
  });

  it("rebuilds from the input log when the engine version changed", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "normal" });
    if (!made.ok) throw new Error(made.error);
    let view = await choose(made.code, made.token, made.view);
    const stored = (await loadBattle(made.code))!;
    // A battle saved by the previous engine (@pkmn/sim 0.10.11).
    stored.rec.meta.simVersion = "0.10.11";
    expect(await saveBattle(made.code, stored.version, { meta: stored.rec.meta })).toBe(true);
    view = await choose(made.code, made.token, (await pollBattle(made.code, made.token, view.log.total) as { view: BattleView }).view);
    expect(view.turn).toBeGreaterThanOrEqual(2);
    expect((await loadBattle(made.code))!.rec.inputLog.filter((l) => l.startsWith(">p1 ")).length).toBe(2);
    expect((await loadBattle(made.code))!.rec.meta.simVersion).toBe(SIM_VERSION);
  });
});

describe("live battles", () => {
  it("each side sees only its own channel and request", async () => {
    const { code, red, blue } = await liveBattle();
    const r = await poll(code, red);
    const b = await poll(code, blue);
    expect(r.request?.data.side.id).toBe("p1");
    expect(b.request?.data.side.id).toBe("p2");
    expect(JSON.stringify(b)).not.toContain('"id":"p1"');
    // Red's exact HP is in Red's channel, only a percentage in Blue's.
    expect(r.log.lines.some((l) => /^\|switch\|p1a: [^|]+\|[^|]+\|\d+\/(?!100\b)\d+/.test(l))).toBe(true);
    expect(b.log.lines.some((l) => /^\|switch\|p1a: [^|]+\|[^|]+\|\d+\/(?!100\b)\d+/.test(l))).toBe(false);
    expect(r.clocks?.you.deadline).toBe(T0 + BATTLE_TIMER.singles.cap);
  });

  it("both players choosing at the same moment both land (compare-and-swap retry)", async () => {
    const { code, red, blue } = await liveBattle();
    const [r, b] = await Promise.all([poll(code, red), poll(code, blue)]);
    const [r2, b2] = await Promise.all([choose(code, red, r), choose(code, blue, b)]);
    // The turn ran with both choices (the later response saw it).
    expect(Math.max(r2.rev, b2.rev)).toBeGreaterThan(Math.max(r.rev, b.rev) + 1);
    const stored = await loadBattle(code);
    expect(stored!.rec.inputLog.filter((l) => /^>p[12] /.test(l))).toHaveLength(2);
    expect(stored!.rec.logs.spectator.filter((l) => /^\|move\|p[12]a: /.test(l)).length).toBeGreaterThanOrEqual(1);
  });

  it("one player choosing first leaves the other's request (and clock) alone", async () => {
    const { code, red, blue } = await liveBattle();
    const [r, b] = [await poll(code, red), await poll(code, blue)];
    at(5_000);
    await choose(code, red, r);
    // Blue still holds the request from before Red chose: it must still be the current one.
    const b2 = await poll(code, blue);
    expect(b2.request?.rqid).toBe(b.request?.rqid);
    expect(b2.clocks?.you.deadline).toBe(b.clocks?.you.deadline);
    await choose(code, blue, b);
  });

  it("retries on a compare-and-swap clash", async () => {
    const { code } = await liveBattle();
    const versionSeen = (await loadBattle(code))!.version;
    let calls = 0;
    const out = await updateBattle(code, (work) => {
      calls += 1;
      if (calls === 1) {
        // Someone else writes in between our read and our write. (The in-memory
        // store writes synchronously, so this lands before our save.)
        const meta = structuredClone(work.meta);
        meta.seats[0].seenAt += 1;
        void saveBattle(code, versionSeen, { meta });
      }
      work.meta.seats[1].seenAt += 7;
      return { ok: true };
    });
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
    const stored = (await loadBattle(code))!;
    // Both writes are in: the other one, and ours redone on top of it.
    expect(stored.rec.meta.seats[0].seenAt).toBe(T0 + 1);
    expect(stored.rec.meta.seats[1].seenAt).toBe(T0 + 7);
  });

  it("running out the clock plays a move, then loses", async () => {
    const { code, red, blue } = await liveBattle();
    const timer = BATTLE_TIMER.singles;
    let now = 0;
    let timeouts = 0;
    let expectedDeadline = T0 + Math.min(timer.bank, timer.cap);
    for (let round = 0; round < 8; round++) {
      // Blue answers everything at once; Red never chooses but stays connected.
      let b = await poll(code, blue);
      while (b.request && b.status === "playing") b = await choose(code, blue, b);
      const r = await poll(code, red);
      if (r.status === "finished") break;
      if (!r.request) continue;
      const deadline = r.clocks!.you.deadline!;
      if (timeouts === 0) expect(deadline).toBe(expectedDeadline);
      // Wait it out, polling (both stay present) without choosing.
      while (now + 30_000 < deadline - T0) {
        now += 30_000;
        at(now);
        await poll(code, red);
        await poll(code, blue);
      }
      now = deadline - T0 + 1_000;
      at(now);
      const after = await poll(code, red);
      timeouts += 1;
      if (timeouts === 1) {
        // The timer played an explicit choice for Red, and the battle went on with less in Red's bank.
        expect(after.status).toBe("playing");
        const stored = (await loadBattle(code))!.rec;
        expect(stored.inputLog.some((l) => l.startsWith(">p1 ") && !/default/.test(l))).toBe(true);
        expect(stored.meta.clocks![0].timeouts).toBe(1);
        // The whole turn came out of the bank (plus the per-turn top-up if Red already has the next request).
        const bank = timer.bank - Math.min(timer.bank, timer.cap);
        expect([bank, bank + 5_000, bank + timer.perTurn]).toContain(stored.meta.clocks![0].bank);
        expectedDeadline = 0;
      } else {
        expect(after.status).toBe("finished");
        expect(after.end).toMatchObject({ reason: "timeout", winner: 1 });
        expect(after.log.lines.some((l) => l === "|win|Blue")).toBe(true);
        break;
      }
    }
    expect(timeouts).toBe(2);
  });

  it("a player who disconnects forfeits", async () => {
    const { code, red } = await liveBattle();
    at(30_000);
    expect((await poll(code, red)).players[1].quiet).toBe(true);
    at(60_000);
    await poll(code, red);
    at(85_000);
    const view = await poll(code, red);
    expect(view.end).toMatchObject({ reason: "left", winner: 0 });
  });

  it("forfeit, then rematch with the same players", async () => {
    const { code, red, blue } = await liveBattle();
    const blueSeat = readBattleToken(blue, code)!;
    const redSeat = readBattleToken(red, code)!;
    const out = await actOnBattle(code, blueSeat.playerId, { action: "forfeit" }, 0);
    expect(out.ok && out.view.end).toMatchObject({ reason: "forfeit", winner: 0 });
    const r1 = await rematchBattle(code, redSeat.playerId);
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.view.status).toBe("lobby");
    const r2 = await rematchBattle(code, blueSeat.playerId);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.code).toBe(r1.code);
    expect(r2.view.status).toBe("playing");
    expect(r2.view.you).toBe(1);
  });

  it("the lobby: names are unique, OU needs a team before ready", async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9randombattle" });
    if (!made.ok) throw new Error(made.error);
    const dup = await actOnBattle(made.code, null, { action: "join", name: "red" }, 0);
    expect(dup.ok).toBe(false);
    const ou = await createLiveBattle({ name: "Red", format: "gen9ou" });
    expect(ou.ok).toBe(false);
  });
});
