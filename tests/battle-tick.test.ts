import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { actOnBattle, battleToken, createLiveBattle, pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { dueBattles, loadBattle, nextDeadline } from "@/lib/server/battle-engine/store";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { TICK_SECRET_HEADER, tickAuthorized, tickBattles } from "@/lib/server/battle-engine/tick";
import { BATTLE_AWAY_MS, type BattleView } from "@/lib/battle/play";

/**
 * The battle tick (POST /api/battle/tick): a live battle nobody polls still
 * runs its clock out and still forfeits a trainer who left, through the same
 * compare-and-swap as a poll.
 */

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);
const SECRET = "tick-test-secret-0123456789";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.stubEnv("BATTLE_TICK_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const at = (ms: number) => vi.setSystemTime(T0 + ms);

async function poll(code: string, token: string) {
  const out = await pollBattle(code, token, 0);
  if (!out.ok) throw new Error(out.error);
  return out.view;
}

async function live() {
  const made = await createLiveBattle({ name: "Red", format: "gen9randombattle" }, Date.now());
  if (!made.ok) throw new Error(made.error);
  const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
  if (!joined.ok) throw new Error(joined.error);
  const red = readBattleToken(made.token, made.code)!;
  await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
  const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
  if (!started.ok) throw new Error(started.error);
  return { code: made.code, red: made.token, blue: battleToken(made.code, joined.playerId, 1) };
}

async function choose(code: string, token: string, view: BattleView) {
  const seat = readBattleToken(token, code)!;
  const out = await actOnBattle(code, seat.playerId, { action: "choose", rqid: view.request!.rqid, choice: firstChoice(view.request!.data, false) }, 0);
  if (!out.ok) throw new Error(out.error);
  return out.view;
}

const stored = async (code: string) => (await loadBattle(code))!.rec;

describe("the battle tick", () => {
  it("runs a clock out with nobody polling: the timer plays a move, and the second timeout loses", async () => {
    const { code, red, blue } = await live();
    let now = 0;
    for (let timeouts = 1; timeouts <= 2; timeouts++) {
      // Blue answers everything; Red is shown a request and never answers.
      let b = await poll(code, blue);
      while (b.request && b.status === "playing") b = await choose(code, blue, b);
      const r = await poll(code, red);
      expect(r.request).toBeTruthy();
      const deadline = r.clocks!.you.deadline! - T0;
      // Both stay present until shortly before the deadline (polls before it catch nothing up)...
      while (now + 30_000 < deadline - 5_000) {
        now += 30_000;
        at(now);
        await poll(code, red);
        await poll(code, blue);
      }
      // ...then nobody polls again. Not due yet: the tick leaves the battle alone.
      expect(await dueBattles(Date.now())).not.toContain(code);
      now = deadline + 1_000;
      at(now);
      expect(nextDeadline((await stored(code)).meta)).toBe(deadline + T0);
      expect(await dueBattles(Date.now())).toContain(code);
      const before = (await loadBattle(code))!.version;
      const sweep = await tickBattles(Date.now());
      expect(sweep.caught).toBeGreaterThanOrEqual(1);
      const loaded = (await loadBattle(code))!;
      // Written through the compare-and-swap (settling a finished battle writes once more).
      expect(loaded.version).toBe(before + (timeouts === 1 ? 1 : 2));
      if (timeouts === 1) {
        // An explicit choice was played for Red, and the battle goes on.
        expect(loaded.rec.meta.status).toBe("playing");
        expect(loaded.rec.meta.clocks![0].timeouts).toBe(1);
        expect(loaded.rec.inputLog.some((l) => l.startsWith(">p1 ") && !/default/.test(l))).toBe(true);
      } else {
        expect(loaded.rec.meta.status).toBe("finished");
        expect(loaded.rec.meta.end).toMatchObject({ reason: "timeout", winner: 1 });
        expect(loaded.rec.logs.spectator).toContain("|win|Blue");
        // Settled by the tick, and nothing more is due.
        expect(sweep.settled).toBe(1);
        expect(loaded.rec.meta.settled).toBeTruthy();
        expect(nextDeadline(loaded.rec.meta)).toBeNull();
        expect(await dueBattles(Date.now())).not.toContain(code);
      }
    }
  });

  it("forfeits a trainer who left, with nobody polling", async () => {
    const { code, red } = await live();
    // Red keeps polling; Blue closed the tab at the start.
    at(30_000);
    await poll(code, red);
    at(60_000);
    await poll(code, red);
    // Then Red's tab goes quiet too. Blue counts as gone BATTLE_AWAY_MS after they were last seen.
    at(BATTLE_AWAY_MS - 1_000);
    expect(await dueBattles(Date.now())).not.toContain(code);
    expect((await tickBattles(Date.now())).caught).toBe(0);
    at(BATTLE_AWAY_MS + 1_000);
    expect(await dueBattles(Date.now())).toContain(code);
    await tickBattles(Date.now());
    const rec = await stored(code);
    expect(rec.meta.status).toBe("finished");
    expect(rec.meta.end).toMatchObject({ reason: "left", winner: 0 });
    // The tick never marks anyone as here: Red's last poll stands.
    expect(rec.meta.seats[0].seenAt).toBe(T0 + 60_000);
  });

  it("does nothing for a battle with nothing due", async () => {
    const { code, red, blue } = await live();
    at(10_000);
    await poll(code, red);
    await poll(code, blue);
    const before = (await loadBattle(code))!.version;
    await tickBattles(Date.now());
    expect((await loadBattle(code))!.version).toBe(before);
  });
});

describe("POST /api/battle/tick", () => {
  it("is a plain 404 without the shared secret, and off with none configured", async () => {
    const { POST } = await import("@/app/api/battle/tick/route");
    const url = "http://localhost/api/battle/tick?once=1";
    expect((await POST(new NextRequest(url, { method: "POST" }))).status).toBe(404);
    expect((await POST(new NextRequest(url, { method: "POST", headers: { [TICK_SECRET_HEADER]: "wrong-secret-0123456789" } }))).status).toBe(404);
    const ok = await POST(new NextRequest(url, { method: "POST", headers: { [TICK_SECRET_HEADER]: SECRET } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, sweeps: 1 });
    vi.stubEnv("BATTLE_TICK_SECRET", "");
    expect(tickAuthorized(SECRET)).toBe(false);
    expect(tickAuthorized("")).toBe(false);
  });
});
