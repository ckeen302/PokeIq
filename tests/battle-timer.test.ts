import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actOnBattle, battleToken, createLiveBattle, pollBattle, readBattleToken, timerOf } from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { BATTLE_TIMER, showdownTimer, timerNagMarks, turnTopUp, VGC_TIMER, type BattleView, type PlayFormatId } from "@/lib/battle/play";

/**
 * The live battle timer against Showdown's (server/room-battle.ts): its
 * numbers, the per-player /timer on and off, the |inactive| messages and
 * what running out of time does.
 */

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());
const at = (ms: number) => vi.setSystemTime(T0 + ms);

async function poll(code: string, token: string) {
  const out = await pollBattle(code, token, 0);
  if (!out.ok) throw new Error(out.error);
  return out.view;
}

async function live(opts: { format?: PlayFormatId; timer?: boolean; timeoutLoses?: boolean } = {}) {
  const made = await createLiveBattle({ name: "Red", format: opts.format ?? "gen9randombattle", timer: opts.timer, timeoutLoses: opts.timeoutLoses }, Date.now());
  if (!made.ok) throw new Error(made.error);
  const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
  if (!joined.ok) throw new Error(joined.error);
  const red = readBattleToken(made.token, made.code)!;
  await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
  const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
  if (!started.ok) throw new Error(started.error);
  return { code: made.code, red: made.token, redId: red.playerId, blue: battleToken(made.code, joined.playerId, 1), blueId: joined.playerId };
}

async function choose(code: string, token: string, view: BattleView) {
  const seat = readBattleToken(token, code)!;
  const out = await actOnBattle(code, seat.playerId, { action: "choose", rqid: view.request!.rqid, choice: firstChoice(view.request!.data, false) }, 0);
  if (!out.ok) throw new Error(out.error);
  return out.view;
}

describe("Showdown's timer numbers", () => {
  it("the ladder timer: 150 s + 60 s grace, +10 s a turn (25 s outside singles), 150 s a turn", () => {
    expect(BATTLE_TIMER.singles).toEqual({ bank: 210_000, refill: 150_000, perTurn: 10_000, cap: 150_000, firstCap: 150_000, accelerate: true });
    expect(BATTLE_TIMER.doubles.perTurn).toBe(25_000);
  });

  it("the VGC Timer comes from the format's own rule (BSS Factory, Battle Tower)", () => {
    for (const format of ["bssfactory", "tower"] as PlayFormatId[]) {
      expect(timerOf({ format })).toEqual({ bank: 510_000, refill: 420_000, perTurn: 0, cap: 55_000, firstCap: 90_000, autoChoose: true });
    }
    expect(showdownTimer("singles", VGC_TIMER)).toEqual(timerOf({ format: "tower" as PlayFormatId }));
    expect(timerOf({ format: "gen9randombattle" })).toEqual(BATTLE_TIMER.singles);
  });

  it("speeds up after turn 100, as Showdown's ladder timer does", () => {
    expect(turnTopUp(BATTLE_TIMER.singles, 50)).toBe(10_000);
    expect(turnTopUp(BATTLE_TIMER.singles, 101)).toBe(5_000);
    expect(turnTopUp(showdownTimer("singles", VGC_TIMER), 150)).toBe(0);
  });

  it("nags every 30 s and every 5 s from 20 s, counted from the request", () => {
    expect(timerNagMarks(150)).toEqual([120, 90, 60, 30, 20, 15, 10, 5]);
    expect(timerNagMarks(55)).toEqual([30, 20, 15, 10, 5]);
  });
});

describe("the timer in a live battle", () => {
  it("starts on request, notes it in the log, and only the one who asked can stop it", async () => {
    const { code, red, redId, blueId } = await live({ timer: false });
    expect((await poll(code, red)).timerStartable).toBe(true);
    const on = await actOnBattle(code, redId, { action: "timer" }, 0);
    expect(on.ok && on.view.clocks?.you.deadline).toBeTruthy();
    expect(on.ok && on.view.timerStoppable).toBe(true);
    let logs = (await loadBattle(code))!.rec.logs.spectator;
    expect(logs).toContain("|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by Red)");
    // Blue didn't ask: can't stop it.
    const refused = await actOnBattle(code, blueId, { action: "timer", on: false }, 0);
    expect(refused.ok && refused.rejected).toMatch(/Only a player who asked/);
    // Blue asks too; Red's stop leaves it on for Blue.
    await actOnBattle(code, blueId, { action: "timer" }, 0);
    await actOnBattle(code, redId, { action: "timer", on: false }, 0);
    logs = (await loadBattle(code))!.rec.logs.spectator;
    expect(logs).toContain("|inactive|Blue also wants the timer to be on.");
    expect(logs).toContain("|inactive|Red no longer wants the timer on, but the timer is staying on because Blue still does.");
    // Blue stops it: off for both.
    const off = await actOnBattle(code, blueId, { action: "timer", on: false }, 0);
    expect(off.ok && off.view.clocks).toBeUndefined();
    expect((await loadBattle(code))!.rec.logs.spectator).toContain("|inactiveoff|Battle timer is now OFF.");
    // Showdown's 20 s cooldown before Blue can turn it back on.
    const soon = await actOnBattle(code, blueId, { action: "timer" }, 0);
    expect(soon.ok && soon.rejected).toMatch(/can't be re-enabled so soon/);
    at(21_000);
    const later = await actOnBattle(code, blueId, { action: "timer" }, 0);
    expect(later.ok && later.view.clocks).toBeTruthy();
  });

  it("Showdown's rules by default: running out of time loses at once, with the message in the log", async () => {
    const { code, red, blue } = await live({ timeoutLoses: true });
    let b = await poll(code, blue);
    while (b.request && b.status === "playing") b = await choose(code, blue, b);
    const r = await poll(code, red);
    const deadline = r.clocks!.you.deadline!;
    // The first request may take the first-turn cap of the 210 s bank.
    expect(deadline - T0).toBe(150_000);
    for (let t = 30_000; t < deadline - T0; t += 30_000) {
      at(t);
      await poll(code, red);
      await poll(code, blue);
    }
    at(deadline - T0 + 1_000);
    const after = await poll(code, blue);
    expect(after.end).toMatchObject({ reason: "timeout", winner: 1 });
    expect((await loadBattle(code))!.rec.logs.spectator).toContain("|-message|Red lost due to inactivity.");
  });

  it("the VGC Timer makes a default move while there's time in the bank", async () => {
    const { code, red, blue } = await live({ format: "bssfactory" as PlayFormatId, timeoutLoses: true });
    let b = await poll(code, blue);
    while (b.request && b.status === "playing") b = await choose(code, blue, b);
    const r = await poll(code, red);
    // Team preview: the first request's 90 s.
    expect(r.clocks!.you.deadline! - T0).toBe(90_000);
    for (let t = 30_000; t <= 90_000; t += 30_000) {
      at(t);
      await poll(code, blue);
      await poll(code, red);
    }
    at(91_000);
    const after = await poll(code, red);
    expect(after.status).toBe("playing");
    const rec = (await loadBattle(code))!.rec;
    // No loss: a default choice was made and the 90 s came out of the 510 s bank.
    expect(rec.meta.end).toBeUndefined();
    expect(rec.meta.clocks![0]).toMatchObject({ bank: 420_000, timeouts: 1 });
    expect(rec.inputLog.filter((l) => l.startsWith(">p1 ")).length).toBeGreaterThan(0);
  });
});
