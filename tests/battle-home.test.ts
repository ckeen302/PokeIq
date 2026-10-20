import { beforeEach, describe, expect, it } from "vitest";
import { Dex, TeamValidator, Teams } from "pokemon-showdown";
import { ALL_FORMATS, PAST_FORMATS, PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { isLadderFormat } from "@/lib/battle/ladder";
import { quickTeam, cpuTeam } from "@/lib/server/battle-engine/teams";
import { battleToken, createCpuBattle, createLiveBattle, createMatchedBattle, hideBattle, pollBattle } from "@/lib/server/battle-engine/service";
import { listWatchable } from "@/lib/server/battle-engine/watch";
import { battleKey } from "@/lib/server/battle-engine/identity";
import { liveCounts, tallyCounts } from "@/lib/server/live-counts";
import { clearMemoryFriends, memoryFriendStore } from "@/lib/server/friends-store";
import { GET as liveRoute } from "@/app/api/live/route";
import NEWS from "@/data/news.json";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

beforeEach(() => clearMemoryFriends());

describe("live counters", () => {
  const key = (id: string) => `key-${id}`;

  it("counts signed-in trainers once, plus everyone else seated in a live battle", () => {
    // u1 is online and battling (counted once); a guest with a ladder key battles twice (once); a seat with no key counts.
    const out = tallyCounts(["u1", "u2"], [["key-u1", "anon-a"], ["anon-a", null], ["key-u3", "anon-b"]], key);
    expect(out).toEqual({ online: 2 + 3 + 1, battles: 3 });
    expect(tallyCounts([], [], key)).toEqual({ online: 0, battles: 0 });
  });

  it("reads presence and live battles, skipping trainers who appear offline", async () => {
    const store = memoryFriendStore();
    const now = Date.now();
    await store.beat("a", now, now + 60_000, null);
    await store.beat("b", now, now + 60_000, null);
    await store.setInvisible("b", true);
    await store.beat("c", now - 300_000, now - 1, null);
    const before = await liveCounts(now);
    const made = await createMatchedBattle("gen9randombattle", [{ name: "Red", player: battleKey("u:a") }, { name: "Blue" }]);
    if (!made) throw new Error("no battle");
    const after = await liveCounts(now);
    expect(after.battles).toBe(before.battles + 1);
    // Red is "a", already counted; Blue is a guest.
    expect(after.online).toBe(before.online + 1);
    expect(before.online).toBeGreaterThanOrEqual(1);
  });

  it("is cached at the CDN for about 30 seconds", async () => {
    const res = await liveRoute();
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=30/);
    expect(await res.json()).toMatchObject({ online: expect.any(Number), battles: expect.any(Number) });
  });
});

describe("past generations", () => {
  it("offers Random Battle, OU and UU from Gen 8 to Gen 1, under Showdown's own names, unladdered", () => {
    expect(PAST_FORMATS).toHaveLength(24);
    for (const id of PAST_FORMATS) {
      const format = Dex.formats.get(id);
      expect(format.exists, id).toBe(true);
      expect(PLAY_FORMAT_INFO[id].name).toBe(format.name);
      expect(PLAY_FORMAT_INFO[id].random).toBe(id.endsWith("randombattle"));
      expect(isLadderFormat(id)).toBe(false);
      expect(ALL_FORMATS).toContain(id);
    }
  });

  it("deals quick and computer teams legal in past formats", () => {
    for (const id of ["gen8ou", "gen5uu", "gen1ou"] as const) {
      const sets = quickTeam(id);
      expect(sets.length, id).toBe(6);
      expect(TeamValidator.get(id).validateTeam(sets as never), id).toBeNull();
      expect(Teams.unpack(cpuTeam(id))?.length, id).toBe(6);
    }
  });

  it("starts a Gen 2 Random Battle against the computer", async () => {
    const out = await createCpuBattle({ name: "Red", format: "gen2randombattle", level: "normal" });
    if (!out.ok) throw new Error(out.error);
    expect(out.view.status).toBe("playing");
    expect(out.view.format).toBe("gen2randombattle");
    expect(out.view.request).toBeTruthy();
  });
});

describe("don't allow spectators", () => {
  it("a hidden matched battle leaves the Watch lobby and refuses spectators, not players", async () => {
    const made = await createMatchedBattle("gen9randombattle", [{ name: "Red" }, { name: "Blue" }]);
    if (!made) throw new Error("no battle");
    expect((await listWatchable(null)).some((e) => e.code === made.code)).toBe(true);
    expect(await hideBattle(made.code, "someone-else")).toMatchObject({ ok: false, status: 403 });
    expect(await hideBattle(made.code, made.ids[1])).toEqual({ ok: true });
    expect((await listWatchable(null)).some((e) => e.code === made.code)).toBe(false);
    expect(await pollBattle(made.code, null, 0, "viewer-1")).toMatchObject({ ok: false, status: 403 });
    expect(await pollBattle(made.code, battleToken(made.code, made.ids[0], 0), 0, null)).toMatchObject({ ok: true });
  });

  it("a friend battle can be opened hidden", async () => {
    const live = await createLiveBattle({ name: "Red", format: "gen9randombattle", hidden: true, public: true });
    if (!live.ok) throw new Error(live.error);
    expect(await pollBattle(live.code, null, 0, "viewer-2")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("news", () => {
  it("has well-formed posts, newest first", () => {
    expect(NEWS.length).toBeGreaterThan(0);
    for (const n of NEWS) {
      expect(n.id).toMatch(/^[a-z0-9-]+$/);
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.title.length).toBeGreaterThan(0);
    }
    expect([...NEWS].sort((a, b) => b.date.localeCompare(a.date)).map((n) => n.id)).toEqual(NEWS.map((n) => n.id));
  });
});
