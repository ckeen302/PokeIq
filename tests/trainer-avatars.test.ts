import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PublicUser } from "@/lib/server/accounts";
import { TRAINER_FIELDS, TRAINER_FIELD_KEYS, V1_FIELDS, checkTrainer, jsonbBytes, lockedItems, parseTrainer, seededTrainer, starterTrainer, unlocked, type TrainerConfig } from "@/lib/trainer/config";
import { TRAINER_PRESETS, matchPreset, presetTrainer } from "@/lib/trainer/presets";

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

const { clearMemoryAvatars, avatarsByNames, avatarStore } = await import("@/lib/server/avatars");
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
    expect(parseTrainer({ ...t, v: 3 })).toBeNull();
    expect(parseTrainer({ ...t, cape: "jetpack" })).toBeNull();
    expect(parseTrainer({ ...t, closed: "yes" })).toBeNull();
    const noSkin: Partial<TrainerConfig> = { ...t };
    delete noSkin.skin;
    expect(parseTrainer(noSkin)).toBeNull();
    expect(parseTrainer(null)).toBeNull();
    expect(parseTrainer([t])).toBeNull();
    // Small enough for the column's check (jsonb, at most 1024 bytes), even with the longest id in every field.
    expect(jsonbBytes(t)).toBeLessThan(1000);
    const worst = { ...t } as Record<string, unknown>;
    for (const key of TRAINER_FIELD_KEYS) worst[key] = [...TRAINER_FIELDS[key]].map((p) => p.id).sort((a, b) => b.length - a.length)[0];
    expect(parseTrainer(worst)).not.toBeNull();
    expect(jsonbBytes(worst as unknown as TrainerConfig)).toBeLessThan(1000);
  });

  it("still loads trainers saved by the first creator (v1), with the same look", () => {
    const v1 = { v: 1, body: "slim", skin: "s3", eyes: "focused", hair: "ponytail", hairColor: "auburn", hat: "beanie", hatColor: "navy", top: "tee", topColor: "teal", accent: "yellow", bottoms: "skirt", bottomsColor: "black", shoes: "boots", shoesColor: "brown", gloves: "full", pack: "satchel", packColor: "orange", ball: "poke", partner: 133, shiny: false };
    const t = parseTrainer(v1)!;
    expect(t).not.toBeNull();
    expect(t.v).toBe(2);
    for (const key of V1_FIELDS) expect(t[key]).toBe(v1[key]);
    expect(t).toMatchObject({ partner: 133, shiny: false, expr: "determined", hatTrim: "yellow", topTrim: "yellow", glovesColor: "yellow", accColor: "yellow", packTrim: "orange", bottomsTrim: "black", emblem: "badge", closed: false, cape: "none", stage: "plain", eyewear: "none" });
    // v1 rows never carried the new fields: anything extra on a v1 row is ignored.
    expect(parseTrainer({ ...v1, cape: "royal", closed: true })).toEqual(t);
    // Parsing the upgraded trainer again changes nothing.
    expect(parseTrainer(t)).toEqual(t);
    expect(checkTrainer(v1, NONE).ok).toBe(true);
    // A v2 trainer missing a newer field gets its default; a wrong one is refused.
    const partial: Record<string, unknown> = { ...t };
    delete partial.stage;
    delete partial.closed;
    expect(parseTrainer(partial)).toEqual(t);
    expect(parseTrainer({ ...t, stage: "moon" })).toBeNull();
  });

  it("offers the ready-made looks, labelled by look, all free to save", () => {
    expect(TRAINER_PRESETS).toHaveLength(15);
    expect(new Set(TRAINER_PRESETS.map((p) => p.id)).size).toBe(15);
    expect(new Set(TRAINER_PRESETS.map((p) => p.name)).size).toBe(15);
    const names = /\b(ash|red|misty|brock|gary|blue|cynthia|jessie|n|leon|dawn|oak|steven|serena|lance|marnie)\b/i;
    for (const preset of TRAINER_PRESETS) {
      expect(preset.name).not.toMatch(names);
      const t = presetTrainer(preset, 6);
      expect(parseTrainer(t)).toEqual(t);
      expect(lockedItems(t, NONE)).toEqual([]);
      expect(jsonbBytes(t)).toBeLessThan(1000);
      expect(matchPreset(t)?.id).toBe(preset.id);
      expect(matchPreset({ ...t, stage: "kanto" })?.id).toBe(preset.id);
    }
    // Every look is different.
    expect(new Set(TRAINER_PRESETS.map((p) => JSON.stringify(p.look))).size).toBe(15);
    expect(matchPreset(starterTrainer())).toBeUndefined();
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
    expect(checkTrainer({ ...t, capeTrim: "gold" }, { ...NONE, badges: 11 }).ok).toBe(false);
    expect(checkTrainer({ ...t, stage: "hall" }, { ...NONE, badges: 9 }).ok).toBe(false);
    expect(checkTrainer({ ...t, stage: "hall" }, { ...NONE, badges: 10 }).ok).toBe(true);
    expect(checkTrainer({ ...t, stage: "kanto", cape: "royal", top: "longcoat", hat: "crown" }, NONE).ok).toBe(true);
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

  it("serves a trainer saved before v2 as v2", async () => {
    const v1 = { v: 1, body: "sturdy", skin: "s2", eyes: "round", hair: "spiky", hairColor: "black", hat: "cap", hatColor: "red", top: "jacket", topColor: "blue", accent: "white", bottoms: "pants", bottomsColor: "navy", shoes: "sneakers", shoesColor: "red", gloves: "fingerless", pack: "classic", packColor: "green", ball: "poke", partner: 25, shiny: false };
    await avatarStore()!.saveTrainer(ash.id, v1 as unknown as TrainerConfig);
    const pub = await (await route.GET(req(null, { query: "?name=ash" }))).json();
    expect(pub.trainer).toEqual(starterTrainer(25));
    const own = await (await route.GET(req("ash"))).json();
    expect(own.trainer.v).toBe(2);
    // Saving it back stores v2.
    expect((await put("ash", own.trainer)).status).toBe(200);
    expect((await avatarsByNames(["ash"])).ash.trainer?.v).toBe(2);
  });

  it("refuses locked items, junk and guests", async () => {
    expect((await put("ash", { ...starterTrainer(), hat: "ace" })).status).toBe(403);
    badges.set(ash.id, 5);
    expect((await put("ash", { ...starterTrainer(), hat: "safari" })).status).toBe(200);
    expect((await put("ash", { ...starterTrainer(), hat: "fedora" })).status).toBe(403);
    expect((await put("ash", { ...starterTrainer(), stage: "space" })).status).toBe(403);
    expect((await put("ash", null)).status).toBe(400);
    expect((await put(null, starterTrainer())).status).toBe(401);
    expect((await avatarsByNames(["ash"])).ash.trainer?.hat).toBe("safari");
  });
});
