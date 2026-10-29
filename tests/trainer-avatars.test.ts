import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PublicUser } from "@/lib/server/accounts";
import { TRAINER_FIELDS, TRAINER_FIELD_KEYS, checkTrainer, lockedItems, parseTrainer, seededTrainer, starterTrainer, unlocked, type TrainerConfig } from "@/lib/trainer/config";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const user = (n: number, username: string): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username, createdAt: "2026-01-01T00:00:00Z" });
const ash = user(1, "Ash");
const users = new Map([ash].map((u) => [u.username.toLowerCase(), u]));
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
    progressDigests: async (ids: string[]) => new Map(ids.map((id) => [id, { xp: 0, daily: null, dle: null, badges: badges.get(id) ?? 0 }])),
  };
});

const { clearMemoryAvatars, avatarsByNames } = await import("@/lib/server/avatars");
const route = await import("@/app/api/avatar/trainer/route");

let ip = 0;
function req(as: string | null, init: { method?: string; body?: unknown; query?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.8.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (as) headers["x-test-user"] = as;
  const url = `http://localhost:3000/api/avatar/trainer${init.query ?? ""}`;
  return new NextRequest(url, { method: init.method ?? "GET", headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
}
const put = (as: string | null, body: unknown) => route.PUT(req(as, { method: "PUT", body }));

const NONE = { level: 1, tier: null, badges: 0 } as const;

beforeEach(() => {
  clearMemoryAvatars();
  badges.clear();
});

describe("trainer configs", () => {
  it("parses only preset ids and a real partner", () => {
    const t = starterTrainer(25);
    expect(parseTrainer(t)).toEqual(t);
    expect(parseTrainer({ ...t, extra: "dropped" })).toEqual(t);
    expect(parseTrainer({ ...t, hat: "tophat" })).toBeNull();
    expect(parseTrainer({ ...t, hair: "<script>" })).toBeNull();
    expect(parseTrainer({ ...t, partner: 0 })).toBeNull();
    expect(parseTrainer({ ...t, partner: 1026 })).toBeNull();
    expect(parseTrainer({ ...t, partner: 25.5 })).toBeNull();
    expect(parseTrainer({ ...t, v: 2 })).toBeNull();
    const noSkin: Partial<TrainerConfig> = { ...t };
    delete noSkin.skin;
    expect(parseTrainer(noSkin)).toBeNull();
    expect(parseTrainer(null)).toBeNull();
    expect(parseTrainer([t])).toBeNull();
    // Small enough for the column's check.
    expect(JSON.stringify(t).length).toBeLessThan(512);
  });

  it("seeds a free-item trainer from a name, the same every time", () => {
    const a = seededTrainer("Misty");
    expect(seededTrainer("misty")).toEqual(a);
    expect(parseTrainer(a)).toEqual(a);
    expect(lockedItems(a, NONE)).toEqual([]);
    const looks = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => JSON.stringify(seededTrainer(n))));
    expect(looks.size).toBeGreaterThan(4);
  });

  it("locks items behind badges and ranked tiers", () => {
    const t = starterTrainer();
    expect(checkTrainer(t, NONE).ok).toBe(true);
    expect(checkTrainer({ ...t, hat: "champion" }, NONE).ok).toBe(false);
    expect(checkTrainer({ ...t, hat: "champion" }, { ...NONE, tier: "ultra" }).ok).toBe(false);
    expect(checkTrainer({ ...t, hat: "champion" }, { ...NONE, tier: "master" }).ok).toBe(true);
    expect(checkTrainer({ ...t, top: "track" }, { ...NONE, badges: 2 }).ok).toBe(false);
    expect(checkTrainer({ ...t, top: "track" }, { ...NONE, badges: 3 }).ok).toBe(true);
    expect(checkTrainer({ ...t, ball: "ultra" }, { ...NONE, tier: "great" }).ok).toBe(false);
    expect(checkTrainer({ ...t, topColor: "gold" }, { ...NONE, badges: 12 }).ok).toBe(true);
    const shiny = checkTrainer({ ...t, shiny: true }, NONE);
    expect(shiny.ok).toBe(false);
    if (!shiny.ok) expect(shiny.error).not.toMatch(/level/i);
    expect(checkTrainer({ ...t, shiny: true }, { ...NONE, level: 10 }).ok).toBe(true);
    // Every locked preset has a hint; every field has free options.
    for (const key of TRAINER_FIELD_KEYS) {
      expect(TRAINER_FIELDS[key].some((p) => unlocked(p, NONE))).toBe(true);
    }
  });
});

describe("/api/avatar/trainer", () => {
  it("saves a trainer, shows it to everyone, and removes it", async () => {
    const t: TrainerConfig = { ...starterTrainer(6), hair: "ponytail", hat: "beanie" };
    expect((await route.GET(req(null, { query: "?name=ash" }))).status).toBe(200);
    expect((await (await route.GET(req(null, { query: "?name=ash" }))).json()).trainer).toBeNull();
    expect((await route.GET(req(null, { query: "?name=nobody" }))).status).toBe(404);
    expect((await route.GET(req(null, { query: "?name=bad%20name!" }))).status).toBe(404);

    const own = await (await route.GET(req("ash"))).json();
    expect(own).toMatchObject({ available: true, trainer: null, unlocks: { badges: 0, tier: null } });

    const res = await put("ash", t);
    expect(res.status).toBe(200);
    expect((await res.json()).avatar.trainer).toEqual(t);
    expect((await avatarsByNames(["ash"])).ash.trainer).toEqual(t);
    const pub = await (await route.GET(req(null, { query: "?name=ASH" }))).json();
    expect(pub).toMatchObject({ username: "Ash", trainer: t });

    expect((await route.DELETE(req("ash", { method: "DELETE" }))).status).toBe(200);
    expect((await avatarsByNames(["ash"])).ash.trainer).toBeUndefined();
  });

  it("refuses locked items, junk and guests", async () => {
    expect((await put("ash", { ...starterTrainer(), hat: "ace" })).status).toBe(403);
    badges.set(ash.id, 5);
    expect((await put("ash", { ...starterTrainer(), hat: "safari" })).status).toBe(200);
    expect((await put("ash", { ...starterTrainer(), hat: "fedora" })).status).toBe(403);
    expect((await put("ash", null)).status).toBe(400);
    expect((await put(null, starterTrainer())).status).toBe(401);
    expect((await avatarsByNames(["ash"])).ash.trainer?.hat).toBe("safari");
  });
});
