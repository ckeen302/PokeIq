import { beforeEach, describe, expect, it } from "vitest";
import { clearMemoryFriends, memoryFriendStore } from "@/lib/server/friends-store";
import {
  answerChallenge,
  answerRequest,
  blockUser,
  cancelChallenge,
  dailyDigest,
  heartbeat,
  listFriends,
  relationOf,
  removeFriend,
  requestFriendByName,
  sendChallenge,
  setAppearOffline,
  unblockUser,
  type Directory,
} from "@/lib/server/friends";
import type { PublicUser } from "@/lib/server/accounts";
import { PRESENCE_TTL_MS, CHALLENGE_TTL_MS, activityFromPath } from "@/lib/community";

const user = (id: string, username: string): PublicUser => ({ id, username, createdAt: "2026-01-01T00:00:00Z" });
const red = user("00000000-0000-0000-0000-00000000000a", "Red");
const blue = user("00000000-0000-0000-0000-00000000000b", "Blue");
const green = user("00000000-0000-0000-0000-00000000000c", "Green");
const all = [red, blue, green];

const digests = new Map<string, { xp: number; daily: unknown; dle: unknown }>();
const dir: Directory = {
  byName: async (name) => all.find((u) => u.username.toLowerCase() === name.toLowerCase()) ?? null,
  byIds: async (ids) => all.filter((u) => ids.includes(u.id)),
  digests: async (ids) => new Map([...digests].filter(([id]) => ids.includes(id))),
};

const T0 = Date.UTC(2026, 9, 20, 12);
let store = memoryFriendStore();
beforeEach(() => {
  clearMemoryFriends();
  digests.clear();
  store = memoryFriendStore();
});

async function befriend(a: PublicUser, b: PublicUser) {
  expect(await requestFriendByName(store, dir, a, b.username, T0)).toMatchObject({ ok: true, status: "sent" });
  expect(await answerRequest(store, dir, b, a.username, true)).toEqual({ ok: true });
}

describe("friend requests", () => {
  it("sends, accepts and lists both ways", async () => {
    await requestFriendByName(store, dir, red, "blue", T0);
    expect(await relationOf(store, red.id, blue.id)).toBe("sent");
    expect(await relationOf(store, blue.id, red.id)).toBe("received");
    const pending = await listFriends(store, dir, blue, T0);
    expect(pending.incoming.map((r) => r.username)).toEqual(["Red"]);
    expect(pending.friends).toEqual([]);
    expect(await answerRequest(store, dir, blue, "Red", true)).toEqual({ ok: true });
    expect((await listFriends(store, dir, red, T0)).friends.map((f) => f.username)).toEqual(["Blue"]);
    expect((await listFriends(store, dir, blue, T0)).friends.map((f) => f.username)).toEqual(["Red"]);
  });

  it("refuses yourself, unknown names, duplicates; asking back accepts", async () => {
    expect(await requestFriendByName(store, dir, red, "Red", T0)).toMatchObject({ ok: false, status: 400 });
    expect(await requestFriendByName(store, dir, red, "Nobody", T0)).toMatchObject({ ok: false, status: 404 });
    await requestFriendByName(store, dir, red, "Blue", T0);
    expect(await requestFriendByName(store, dir, red, "Blue", T0)).toMatchObject({ ok: false, status: 409 });
    expect(await requestFriendByName(store, dir, blue, "Red", T0)).toMatchObject({ ok: true, status: "friends" });
    expect(await requestFriendByName(store, dir, red, "Blue", T0)).toMatchObject({ ok: false, status: 409 });
  });

  it("only the receiver can accept or decline; declining and cancelling delete the request", async () => {
    await requestFriendByName(store, dir, red, "Blue", T0);
    expect(await answerRequest(store, dir, red, "Blue", true)).toMatchObject({ ok: false, status: 404 });
    expect(await answerRequest(store, dir, blue, "Red", false)).toEqual({ ok: true });
    expect(await relationOf(store, red.id, blue.id)).toBe("none");
    await requestFriendByName(store, dir, red, "Blue", T0);
    expect(await removeFriend(store, dir, blue, "Red")).toMatchObject({ ok: false });
    expect(await removeFriend(store, dir, red, "Blue")).toEqual({ ok: true });
    expect(await relationOf(store, blue.id, red.id)).toBe("none");
  });

  it("blocking removes the friendship and stops requests both ways", async () => {
    await befriend(red, blue);
    expect(await blockUser(store, dir, blue, "Red")).toEqual({ ok: true });
    expect(await relationOf(store, red.id, blue.id)).toBe("none");
    expect(await relationOf(store, blue.id, red.id)).toBe("blocked");
    expect(await requestFriendByName(store, dir, red, "Blue", T0)).toMatchObject({ ok: false, status: 403 });
    expect(await requestFriendByName(store, dir, blue, "Red", T0)).toMatchObject({ ok: false, status: 403 });
    expect((await listFriends(store, dir, blue, T0)).blocked).toEqual(["Red"]);
    await unblockUser(store, dir, blue, "Red");
    expect(await requestFriendByName(store, dir, red, "Blue", T0)).toMatchObject({ ok: true });
  });

  it("a pending request can't be accepted once the receiver blocks", async () => {
    await requestFriendByName(store, dir, red, "Blue", T0);
    await blockUser(store, dir, blue, "Red");
    expect(await answerRequest(store, dir, blue, "Red", true)).toMatchObject({ ok: false });
  });
});

describe("presence", () => {
  it("is online until the TTL runs out, then offline", async () => {
    await befriend(red, blue);
    await heartbeat(store, dir, blue, { kind: "pokedle", label: "Playing Pokédle" }, T0);
    const seen = (await listFriends(store, dir, red, T0 + PRESENCE_TTL_MS - 1)).friends[0];
    expect(seen).toMatchObject({ username: "Blue", online: true, activity: { label: "Playing Pokédle" } });
    const later = (await listFriends(store, dir, red, T0 + PRESENCE_TTL_MS)).friends[0];
    expect(later).toMatchObject({ online: false, activity: null });
    expect(await store.onlineIds(T0 + 1)).toEqual([blue.id]);
    expect(await store.onlineIds(T0 + PRESENCE_TTL_MS)).toEqual([]);
  });

  it("appear offline hides status and activity from friends, and from the online count", async () => {
    await befriend(red, blue);
    await setAppearOffline(store, blue, true);
    await heartbeat(store, dir, blue, { kind: "battle", label: "In a Gen 9 OU battle" }, T0);
    expect((await listFriends(store, dir, red, T0)).friends[0]).toMatchObject({ online: false, activity: null });
    expect((await listFriends(store, dir, blue, T0)).appearOffline).toBe(true);
    expect(await store.onlineIds(T0)).toEqual([]);
    await setAppearOffline(store, blue, false);
    expect((await listFriends(store, dir, red, T0)).friends[0].online).toBe(true);
  });

  it("shows nothing to trainers who aren't accepted friends", async () => {
    await heartbeat(store, dir, blue, { kind: "pokedle", label: "Playing Pokédle" }, T0);
    digests.set(blue.id, { xp: 10, daily: null, dle: { last: "2026-10-20", streak: 3, results: { "2026-10-20": { guesses: [1, 2, 3], solved: true, over: true } } } });
    await requestFriendByName(store, dir, red, "Blue", T0);
    const mine = await listFriends(store, dir, red, T0);
    expect(mine.friends).toEqual([]);
    expect(mine.outgoing).toEqual([{ username: "Blue", at: T0 }]);
    expect(JSON.stringify(mine)).not.toMatch(/Pokédle|online":true|guesses/);
    await answerRequest(store, dir, blue, "Red", true);
    expect((await listFriends(store, dir, red, T0)).friends[0].daily).toEqual({ dle: { date: "2026-10-20", solved: true, guesses: 3, streak: 3 } });
  });

  it("reads the activity a page reports from its path", () => {
    expect(activityFromPath("/battle/live/abcdefgh")).toEqual({ kind: "battle", code: "abcdefgh" });
    expect(activityFromPath("/pokedle")).toEqual({ kind: "pokedle" });
    expect(activityFromPath("/pokedle/duel/abcdefgh")).toEqual({ kind: "duel" });
    expect(activityFromPath("/")).toEqual({ kind: "browsing" });
  });

  it("digests a friend's dailies defensively", () => {
    expect(dailyDigest(undefined)).toBeNull();
    expect(dailyDigest({ xp: 0, daily: "junk", dle: 5 })).toBeNull();
    const out = dailyDigest(
      { xp: 0, daily: { last: "2026-10-01", streak: 9, results: { "2026-09-30": { correct: 4, total: 10 }, "2026-10-01": { correct: 7, total: 10 } } }, dle: null },
      T0
    );
    // The streak broke weeks ago.
    expect(out).toEqual({ daily: { date: "2026-10-01", correct: 7, total: 10, streak: 0 } });
  });
});

describe("challenges", () => {
  const game = { kind: "battle" as const, code: "abcdefgh", label: "Gen 9 Random Battle" };

  it("go to accepted friends only, arrive on the next heartbeat, and are answered once", async () => {
    expect(await sendChallenge(store, dir, red, "Blue", game, T0)).toMatchObject({ ok: false, status: 403 });
    await befriend(red, blue);
    const sent = await sendChallenge(store, dir, red, "Blue", game, T0);
    if (!sent.ok) throw new Error(sent.error);
    const beat = await heartbeat(store, dir, blue, null, T0 + 1000);
    expect(beat.challenges).toEqual([{ id: sent.id, from: "Red", kind: "battle", label: "Gen 9 Random Battle", href: "/battle/live/abcdefgh", expiresAt: T0 + CHALLENGE_TTL_MS }]);
    expect(await answerChallenge(store, red, sent.id, true, T0 + 2000)).toMatchObject({ ok: false, status: 404 });
    expect(await answerChallenge(store, blue, sent.id, true, T0 + 2000)).toEqual({ ok: true, href: "/battle/live/abcdefgh" });
    expect(await answerChallenge(store, blue, sent.id, false, T0 + 2000)).toMatchObject({ ok: false, status: 409 });
    expect((await heartbeat(store, dir, blue, null, T0 + 3000)).challenges).toEqual([]);
    // The challenger hears the answer once.
    expect((await heartbeat(store, dir, red, null, T0 + 3000)).answers).toEqual([{ id: sent.id, to: "Blue", label: "Gen 9 Random Battle", status: "accepted" }]);
    expect((await heartbeat(store, dir, red, null, T0 + 4000)).answers).toEqual([]);
  });

  it("expire, can be taken back, and are dropped by a block", async () => {
    await befriend(red, blue);
    const a = await sendChallenge(store, dir, red, "Blue", game, T0);
    if (!a.ok) throw new Error(a.error);
    expect(await answerChallenge(store, blue, a.id, true, T0 + CHALLENGE_TTL_MS)).toMatchObject({ ok: false, status: 404 });
    const b = await sendChallenge(store, dir, red, "Blue", game, T0);
    if (!b.ok) throw new Error(b.error);
    expect(await cancelChallenge(store, blue, b.id)).toMatchObject({ ok: false });
    expect(await cancelChallenge(store, red, b.id)).toEqual({ ok: true });
    const c = await sendChallenge(store, dir, red, "Blue", game, T0);
    if (!c.ok) throw new Error(c.error);
    await blockUser(store, dir, blue, "Red");
    expect((await heartbeat(store, dir, blue, null, T0)).challenges).toEqual([]);
    expect(await sendChallenge(store, dir, red, "Blue", game, T0)).toMatchObject({ ok: false, status: 403 });
  });

  it("a new challenge to the same friend replaces the last; the heartbeat counts requests", async () => {
    await befriend(red, blue);
    await sendChallenge(store, dir, red, "Blue", game, T0);
    await sendChallenge(store, dir, red, "Blue", { ...game, code: "bcdefghj" }, T0);
    const beat = await heartbeat(store, dir, blue, null, T0);
    expect(beat.challenges.map((c) => c.href)).toEqual(["/battle/live/bcdefghj"]);
    await requestFriendByName(store, dir, green, "Blue", T0);
    expect((await heartbeat(store, dir, blue, null, T0)).requests).toBe(1);
  });
});

describe("games behind challenges and activity", () => {
  it("a challenge needs the challenger's own battle, still in its lobby", async () => {
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
    const { createLiveBattle, createMatchedBattle, battleToken } = await import("@/lib/server/battle-engine/service");
    const { challengeGame, battleActivity, battlePhrase } = await import("@/lib/server/community-games");
    const { battleKey } = await import("@/lib/server/battle-engine/identity");
    const live = await createLiveBattle({ name: "Red", format: "gen9randombattle" });
    if (!live.ok) throw new Error(live.error);
    expect(await challengeGame("battle", live.code, live.token)).toEqual({ ok: true, label: "Gen 9 Random Battle" });
    expect(await challengeGame("battle", live.code, "forged")).toMatchObject({ ok: false, status: 404 });
    expect(await challengeGame("pokedle", live.code, live.token)).toMatchObject({ ok: false });
    expect(battlePhrase("[Gen 9] OU")).toBe("Gen 9 OU battle");

    // A public battle under way: friends get a Watch link only if this account is seated in it.
    const made = await createMatchedBattle("gen9randombattle", [{ name: "Red", player: battleKey(`u:${red.id}`) }, { name: "Blue" }]);
    if (!made) throw new Error("no battle");
    expect(await battleActivity(made.code, red.id)).toEqual({ kind: "battle", label: "In a Gen 9 Random Battle", watch: made.code });
    expect(await battleActivity(made.code, blue.id)).toEqual({ kind: "battle", label: "In a battle" });
    expect(await challengeGame("battle", made.code, battleToken(made.code, made.ids[0], 0))).toMatchObject({ ok: false, status: 409 });
  });
});
