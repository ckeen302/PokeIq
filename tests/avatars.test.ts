import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PublicUser } from "@/lib/server/accounts";
import { AVATAR_MAX_ID, bestTier, checkAvatar, defaultAvatar, frameHint, frameUnlocked, levelFromXp, shinyUnlocked } from "@/lib/avatar";
import { levelInfo } from "@/lib/progress";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const user = (n: number, username: string): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username, createdAt: "2026-01-01T00:00:00Z" });
const ash = user(1, "Ash");
const misty = user(2, "Misty");
const users = new Map([ash, misty].map((u) => [u.username.toLowerCase(), u]));
const xp = new Map<string, number>();
const badges = new Map<string, number>();

vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return {
    ...real,
    sessionTokenHash: (r: NextRequest) => r.headers.get("x-test-user"),
    userFromRequest: async (r: NextRequest) => users.get(r.headers.get("x-test-user") ?? "") ?? null,
  };
});
vi.mock("@/lib/server/accounts", async (orig) => {
  const real = await orig<typeof import("@/lib/server/accounts")>();
  return {
    ...real,
    accountsEnabled: () => true,
    usersByIds: async (ids: string[]) => [...users.values()].filter((u) => ids.includes(u.id)),
    usersByNames: async (names: string[]) => [...users.values()].filter((u) => names.map((n) => n.toLowerCase()).includes(u.username.toLowerCase())),
    progressDigests: async (ids: string[]) => new Map(ids.map((id) => [id, { xp: xp.get(id) ?? 0, daily: null, dle: null, badges: badges.get(id) ?? 0 }])),
  };
});

const { clearMemoryAvatars, avatarsByNames } = await import("@/lib/server/avatars");
const { clearMemoryRanked, memoryRankedStore, rankedKey } = await import("@/lib/server/ranked");
const route = await import("@/app/api/avatar/route");

let ip = 0;
function req(as: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.9.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (as) headers["x-test-user"] = as;
  return new NextRequest("http://localhost:3000/api/avatar", body === undefined ? { headers } : { method: "PUT", headers, body: JSON.stringify(body) });
}
const put = (as: string, body: unknown) => route.PUT(req(as, body));

beforeEach(() => {
  clearMemoryAvatars();
  clearMemoryRanked();
  xp.clear();
  badges.clear();
});

describe("avatar unlocks", () => {
  it("unlocks shiny by playing, and frames with badges or ranked tiers (never levels)", () => {
    expect(shinyUnlocked({ level: 9, tier: null, badges: 0 })).toBe(false);
    expect(shinyUnlocked({ level: 10, tier: null, badges: 0 })).toBe(true);
    expect(frameUnlocked("none", { level: 1, tier: null, badges: 0 })).toBe(true);
    expect(frameUnlocked("lv5", { level: 99, tier: null, badges: 2 })).toBe(false);
    expect(frameUnlocked("lv5", { level: 1, tier: null, badges: 3 })).toBe(true);
    expect(frameUnlocked("lv15", { level: 1, tier: null, badges: 8 })).toBe(true);
    expect(frameUnlocked("lv50", { level: 99, tier: null, badges: 23 })).toBe(false);
    expect(frameUnlocked("lv50", { level: 1, tier: null, badges: 24 })).toBe(true);
    expect(frameUnlocked("great", { level: 99, tier: null, badges: 31 })).toBe(false);
    expect(frameUnlocked("great", { level: 1, tier: "ultra", badges: 0 })).toBe(true);
    expect(frameUnlocked("master", { level: 1, tier: "ultra", badges: 0 })).toBe(false);
    expect(frameHint("lv30")).not.toMatch(/level/i);
  });

  it("checks the Pokémon is in range", () => {
    const u = { level: 1, tier: null, badges: 0 };
    expect(checkAvatar({ pokemonId: 25, shiny: false, frame: "none" }, u).ok).toBe(true);
    for (const pokemonId of [0, AVATAR_MAX_ID + 1, 1.5, "25"]) expect(checkAvatar({ pokemonId, shiny: false, frame: "none" }, u).ok).toBe(false);
    expect(checkAvatar({ pokemonId: 25, shiny: false, frame: "gold-plated" }, u).ok).toBe(false);
    expect(checkAvatar(null, u).ok).toBe(false);
  });

  it("ranks tiers from ratings and levels like the trainer card", () => {
    expect(bestTier([])).toBeNull();
    expect(bestTier([1100])).toBeNull();
    expect(bestTier([1100, 1250])).toBe("great");
    expect(bestTier([1500])).toBe("ultra");
    expect(bestTier([2000])).toBe("master");
    for (const n of [0, 49, 50, 199, 200, 4999, 5000, 123456]) expect(levelFromXp(n)).toBe(levelInfo(n).level);
  });
});

describe("the default avatar", () => {
  it("is the same Pokémon for the same name, whatever the case", () => {
    expect(defaultAvatar("Ash")).toEqual(defaultAvatar("ash"));
    expect(defaultAvatar("Ash")).toEqual(defaultAvatar("ASH"));
    const a = defaultAvatar("Ash");
    expect(a.shiny).toBe(false);
    expect(a.frame).toBe("none");
    expect(a.pokemonId).toBeGreaterThanOrEqual(1);
    expect(a.pokemonId).toBeLessThanOrEqual(AVATAR_MAX_ID);
    const ids = new Set(["Ash", "Misty", "Brock", "Gary", "Oak", "Red", "Blue", "Leaf"].map((n) => defaultAvatar(n).pokemonId));
    expect(ids.size).toBeGreaterThan(4);
  });

  it("is what a new account shows, and guests get nothing", async () => {
    const res = await route.GET(req("ash"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatar).toEqual(defaultAvatar("Ash"));
    expect(body.unlocks).toEqual({ level: 1, tier: null, badges: 0 });
    expect((await route.GET(req(null))).status).toBe(401);
    const map = await avatarsByNames(["Ash", "SomeGuest"]);
    expect(map.ash).toEqual(defaultAvatar("Ash"));
    expect(map.someguest).toBeUndefined();
  });
});

describe("saving an avatar", () => {
  it("saves an unlocked pick and shows it to everyone", async () => {
    const res = await put("ash", { pokemonId: 25, shiny: false, frame: "none" });
    expect(res.status).toBe(200);
    expect((await avatarsByNames(["ash"])).ash).toEqual({ pokemonId: 25, shiny: false, frame: "none" });
    expect((await (await route.GET(req("ash"))).json()).avatar.pokemonId).toBe(25);
  });

  it("refuses a locked shiny or frame, and anything out of range", async () => {
    let res = await put("ash", { pokemonId: 25, shiny: true, frame: "none" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/keep playing/i);
    res = await put("ash", { pokemonId: 25, shiny: false, frame: "lv15" });
    expect(res.status).toBe(403);
    res = await put("ash", { pokemonId: 25, shiny: false, frame: "great" });
    expect(res.status).toBe(403);
    expect((await put("ash", { pokemonId: 1026, shiny: false, frame: "none" })).status).toBe(403);
    expect((await put("ash", { pokemonId: 25, shiny: false, frame: "none", extra: "x" })).status).toBe(200);
    // Nothing locked was stored.
    expect((await avatarsByNames(["ash"])).ash).toEqual({ pokemonId: 25, shiny: false, frame: "none" });
    expect((await route.PUT(req(null, { pokemonId: 25, shiny: false, frame: "none" }))).status).toBe(401);
  });

  it("unlocks shiny with play, badge frames with badges, and tier frames with a ranked rating", async () => {
    xp.set(ash.id, 50 * 14 ** 2); // activity level 15
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "lv15" })).status).toBe(403);
    badges.set(ash.id, 8);
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "lv15" })).status).toBe(200);
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "lv30" })).status).toBe(403);
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "great" })).status).toBe(403);
    await memoryRankedStore().apply({
      code: "T1",
      keys: [rankedKey(`u:${ash.id}`), rankedKey(`u:${misty.id}`)],
      names: ["Ash", "Misty"],
      expect: [
        { rating: 1000, games: 0 },
        { rating: 1000, games: 0 },
      ],
      after: [1250, 950],
      scores: [1, 0],
    });
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "great" })).status).toBe(200);
    expect((await put("ash", { pokemonId: 6, shiny: true, frame: "ultra" })).status).toBe(403);
    expect((await put("misty", { pokemonId: 6, shiny: false, frame: "great" })).status).toBe(403);
  });
});
