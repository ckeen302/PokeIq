import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dex, TeamValidator, Teams } from "pokemon-showdown";
import { actOnBattle, battleToken, createCpuBattle, createLiveBattle, pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { cpuTeam } from "@/lib/server/battle-engine/teams";
import { randomTeam } from "@/lib/server/battle";
import { BATTLE_FORMATS, hasTera } from "@/lib/battle/formats";
import { PLAY_FORMATS, PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { LADDER_FORMATS } from "@/lib/battle/ladder";
import { timerWarning } from "@/lib/battle/timer-warning";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const NEW_FORMATS = ["gen9ru", "gen9nu", "gen9pu", "gen9lc", "gen9monotype", "gen9nationaldex"] as const;

describe("Phase 1 formats", () => {
  it("are Pokémon Showdown's own formats, playable, laddered and in the team builder", () => {
    for (const id of NEW_FORMATS) {
      const f = Dex.formats.get(id);
      expect(f.exists, id).toBe(true);
      expect(PLAY_FORMATS).toContain(id);
      expect(LADDER_FORMATS).toContain(id);
      expect(PLAY_FORMAT_INFO[id].name).toBe(f.name);
      expect(BATTLE_FORMATS[id].name).toBe(f.name);
    }
    // Showdown's Terastal Clause.
    expect(hasTera(BATTLE_FORMATS.gen9monotype)).toBe(false);
    expect(hasTera(BATTLE_FORMATS.gen9nationaldex)).toBe(false);
    expect(hasTera(BATTLE_FORMATS.gen9lc)).toBe(true);
  });

  it("build the computer a team that passes each format's validator", () => {
    for (const id of NEW_FORMATS) {
      const team = Teams.unpack(cpuTeam(id))!;
      expect(team, id).toHaveLength(6);
      expect(TeamValidator.get(id).validateTeam(team), id).toBeNull();
    }
  }, 60_000);

  it("draws Monotype teams that share a type, and LC teams at level 5", () => {
    const mono = randomTeam("gen9monotype");
    const shared = mono.map((s) => new Set(Dex.species.get(s.species).types)).reduce((a, b) => new Set([...a].filter((t) => b.has(t))));
    expect(shared.size).toBeGreaterThan(0);
    expect(randomTeam("gen9lc").every((s) => s.level === 5)).toBe(true);
  }, 60_000);

  it("start a battle against the computer", async () => {
    const quick = Teams.export(Teams.unpack(cpuTeam("gen9ru"))!);
    const made = await createCpuBattle({ name: "Red", format: "gen9ru", level: "easy", team: quick });
    if (!made.ok) throw new Error(made.error);
    expect(made.view.status).toBe("playing");
  }, 60_000);
});

describe("Timer warnings", () => {
  it("warn at 30 and 10 seconds", () => {
    expect(timerWarning(null)).toBeNull();
    expect(timerWarning(45_000)).toBeNull();
    expect(timerWarning(29_500)).toMatch(/30 seconds left to choose/);
    expect(timerWarning(9_000)).toBe("9 seconds left!");
    expect(timerWarning(0)).toBeNull();
  });
});

describe("Loss on timeout", () => {
  const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("loses at the first timeout when the battle was opened with it", async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9randombattle", timeoutLoses: true }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
    if (!joined.ok) throw new Error(joined.error);
    const red = readBattleToken(made.token, made.code)!;
    await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
    const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
    if (!started.ok) throw new Error(started.error);
    expect(started.view.timeoutLoses).toBe(true);
    const blue = battleToken(made.code, joined.playerId, 1);
    // Blue chooses; Red sits on their turn (polling, so never "disconnected") until the clock runs out.
    const b = await pollBattle(made.code, blue, 0);
    if (!b.ok || !b.view.request) throw new Error("blue has no request");
    const r0 = await pollBattle(made.code, made.token, 0);
    if (!r0.ok) throw new Error(r0.error);
    const deadline = r0.view.clocks!.you.deadline!;
    let now = 0;
    while (T0 + now + 15_000 < deadline) {
      now += 15_000;
      vi.setSystemTime(T0 + now);
      await pollBattle(made.code, made.token, 0);
      await pollBattle(made.code, blue, 0);
    }
    vi.setSystemTime(deadline + 1_000);
    const after = await pollBattle(made.code, made.token, 0);
    if (!after.ok) throw new Error(after.error);
    expect(after.view.status).toBe("finished");
    expect(after.view.end).toMatchObject({ reason: "timeout", winner: 1 });
  });
});
