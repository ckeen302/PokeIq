import { describe, expect, it } from "vitest";
import { TeamValidator, Teams } from "pokemon-showdown";
import { nextRunBattle, runResult, startTowerRun } from "@/lib/server/battle-engine/frontier";
import { TOWER_FORMAT, towerQuickTeam, towerTeam, tycoonTeam } from "@/lib/server/battle-engine/teams";
import { actOnBattle, pollBattle, readBattleToken, updateBattle } from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { packTeam } from "@/lib/battle/sets";

const legal = (team: unknown[]) => TeamValidator.get(TOWER_FORMAT).validateTeam(structuredClone(team) as never);

/** Wins every battle of a run up to `wins` by making the computer lose; returns the last result. */
async function winBattles(token: string, wins: number) {
  let run = token;
  let last: Awaited<ReturnType<typeof runResult>> | null = null;
  for (let i = 0; i < wins; i++) {
    const battle = await nextRunBattle(run);
    if (!battle.ok) throw new Error(battle.error);
    await updateBattle(battle.code, (work, now) => {
      work.session(now)!.lose("p2");
      work.absorb(now);
      return { ok: true };
    });
    last = await runResult(battle.code, battle.token, null);
    if (!last.ok) throw new Error(last.error);
    run = last.run.token;
  }
  return last!;
}

describe("the Battle Tower", () => {
  it("deals the computer validated Flat Rules teams, and the Tycoon Battle Stadium sets", () => {
    const team = towerTeam();
    expect(team).toHaveLength(6);
    expect(legal(team)).toBeNull();
    const boss = tycoonTeam("3,1,4,1");
    expect(boss).toHaveLength(6);
    expect(legal(boss)).toBeNull();
    expect(legal(towerQuickTeam())).toBeNull();
  });

  it("checks the player's team for Flat Rules, with Showdown's messages", () => {
    const bad = startTowerRun("Red", "Mew @ Leftovers\nAbility: Synchronize\n- Psychic\n\nMewtwo\nAbility: Pressure\n- Psystrike\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Mew/);
    expect(startTowerRun("Red", packTeam(towerQuickTeam())).ok).toBe(true);
  });

  it("plays with team preview (pick three) and brings out the Tycoon at the seventh battle", async () => {
    const started = startTowerRun("Red", packTeam(towerQuickTeam()));
    if (!started.ok) throw new Error(started.error);
    const battle = await nextRunBattle(started.run.token);
    if (!battle.ok) throw new Error(battle.error);
    const me = readBattleToken(battle.token, battle.code)!;
    const polled = await pollBattle(battle.code, battle.token, 0);
    if (!polled.ok) throw new Error(polled.error);
    const request = polled.view.request!;
    expect(request.data.teamPreview).toBe(true);
    expect(request.data.maxChosenTeamSize).toBe(3);
    const chose = await actOnBattle(battle.code, me.playerId, { action: "choose", rqid: request.rqid, choice: "team 213" }, polled.view.log.total);
    if (!chose.ok) throw new Error(chose.error);
    expect(chose.rejected).toBeUndefined();
    expect(chose.view.turn).toBe(1);
    const rec = await loadBattle(battle.code);
    expect(rec!.rec.meta.formatid ?? "").toBe("");
    // Level 50 for everyone, three each.
    expect(chose.view.log.lines.join("\n")).toMatch(/\|teamsize\|p1\|3/);
    expect(chose.view.log.lines.some((l) => l.startsWith("|switch|p1a:") && l.includes(", L50"))).toBe(true);
  });

  it("calls the seventh battle the Tower Tycoon's", async () => {
    const started = startTowerRun("Red", packTeam(towerQuickTeam()));
    if (!started.ok) throw new Error(started.error);
    const six = await winBattles(started.run.token, 6);
    if (!six.ok) throw new Error("no result");
    expect(six.run.streak).toBe(6);
    expect(six.run.next.boss).toBe(true);
    expect(six.run.next.level).toBe("hard");
    const boss = await nextRunBattle(six.run.token);
    if (!boss.ok) throw new Error(boss.error);
    const polled = await pollBattle(boss.code, boss.token, 0);
    if (!polled.ok) throw new Error(polled.error);
    expect(polled.view.players[1].name).toBe("Tower Tycoon");
    expect(polled.view.frontier).toMatchObject({ mode: "tower", boss: true, battle: 7, streak: 6 });
    // The Tycoon's team stays hidden: only species at team preview.
    const tycoon = Teams.unpack((await loadBattle(boss.code))!.rec.meta.seats[1].team!)!;
    expect(polled.view.log.lines.join("\n")).not.toContain(tycoon[0].moves[0]);
  });
});
