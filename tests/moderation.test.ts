import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PublicUser } from "@/lib/server/accounts";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const user = (n: number, username: string): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username, createdAt: "2026-01-01T00:00:00Z" });
const mod = user(1, "Oak");
const red = user(2, "Red");
const blue = user(3, "Blue");
const users = new Map([mod, red, blue].map((u) => [u.username.toLowerCase(), u]));

// Signed in as whoever the x-test-user header names; accounts found by name.
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
    findUserByName: async (name: string) => {
      const u = users.get(name.toLowerCase());
      return u ? { ...u, passwordHash: "", recoveryCodeHash: null } : null;
    },
    findUserById: async (id: string) => [...users.values()].find((u) => u.id === id) ?? null,
    usersByIds: async (ids: string[]) => [...users.values()].filter((u) => ids.includes(u.id)),
  };
});

const { clearMemoryModeration, blockedReason } = await import("@/lib/server/moderation");
const { clearMemoryReports, memoryReports } = await import("@/lib/server/reports");
const { clearMemoryRooms } = await import("@/lib/server/rooms");
const { clearMemoryFriends } = await import("@/lib/server/friends-store");
const admin = await import("@/app/api/admin/route");
const reportRoute = await import("@/app/api/report/route");
const roomRoute = await import("@/app/api/rooms/[id]/route");
const battleRoute = await import("@/app/api/battle/route");
const battleCodeRoute = await import("@/app/api/battle/[code]/route");
const battleMatch = await import("@/app/api/battle/match/route");
const duelRoute = await import("@/app/api/duel/[code]/route");
const friendsRoute = await import("@/app/api/friends/route");
const tourRoute = await import("@/app/api/tournaments/route");

let ip = 0;
function req(path: string, as?: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.2.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" };
  if (as) headers["x-test-user"] = as;
  return new NextRequest(`http://localhost:3000${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
}
const params = <T extends string>(key: T, value: string) => ({ params: Promise.resolve({ [key]: value } as Record<T, string>) });
const act = (body: Record<string, unknown>) => admin.POST(req("/api/admin", "oak", body));

beforeEach(() => {
  process.env.POKEIQ_ADMINS = "Oak";
  clearMemoryModeration();
  clearMemoryReports();
  clearMemoryRooms();
  clearMemoryFriends();
});
afterEach(() => {
  delete process.env.POKEIQ_ADMINS;
});

describe("the admin page's API", () => {
  it("is for POKEIQ_ADMINS only: everyone else gets a 404", async () => {
    expect((await admin.GET(req("/api/admin?tab=audit"))).status).toBe(404);
    expect((await admin.GET(req("/api/admin?tab=audit", "red"))).status).toBe(404);
    expect((await admin.POST(req("/api/admin", "red", { action: "mute", name: "Blue", duration: "1h" }))).status).toBe(404);
    expect((await admin.GET(req("/api/admin?tab=audit", "oak"))).status).toBe(200);
    // Nobody is an admin by default.
    delete process.env.POKEIQ_ADMINS;
    expect((await admin.GET(req("/api/admin?tab=audit", "oak"))).status).toBe(404);
  });

  it("logs every action", async () => {
    expect((await act({ action: "mute", name: "Red", duration: "24h" })).status).toBe(200);
    expect((await act({ action: "ban", name: "Blue", reason: "Spam" })).status).toBe(200);
    const { entries } = await (await admin.GET(req("/api/admin?tab=audit", "oak"))).json();
    expect(entries.map((e: { action: string; target: string }) => `${e.action} ${e.target}`)).toEqual(["ban Blue", "mute Red"]);
    expect((await act({ action: "mute", name: "Oak", duration: "1h" })).status).toBe(409);
  });
});

describe("mutes and bans, enforced on the server everywhere", () => {
  const room = (as: string) => roomRoute.POST(req("/api/rooms/lobby", as, { action: "post", text: "hello" }), params("id", "lobby"));
  const battleChat = (as: string) => battleCodeRoute.POST(req("/api/battle/abcdefgh", as, { action: "chat", token: "x".repeat(20), text: "hi", since: 0 }), params("code", "abcdefgh"));
  const duelChat = (as: string) => duelRoute.POST(req("/api/duel/abcdefgh", as, { action: "chat", token: "x".repeat(20), text: "hi" }), params("code", "abcdefgh"));
  const openPvp = (as: string) => battleRoute.POST(req("/api/battle", as, { mode: "pvp", name: "Red", format: "gen9randombattle" }));
  const search = (as: string) => battleMatch.POST(req("/api/battle/match", as, { action: "search", settings: { format: "gen9randombattle" }, name: "Red" }));
  const friend = (as: string) => friendsRoute.POST(req("/api/friends", as, { action: "request", username: "Oak" }));
  const tournament = (as: string) => tourRoute.POST(req("/api/tournaments", as, { format: "gen9randombattle", style: "elim", maxPlayers: 8, signupMinutes: 5, bestOf: 1 }));

  it("a mute stops chat in rooms, battles and duels, but not playing", async () => {
    expect((await room("red")).status).toBe(200);
    await act({ action: "mute", name: "Red", duration: "1h" });
    for (const res of [await room("red"), await battleChat("red"), await duelChat("red")]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/muted/);
    }
    expect((await openPvp("red")).status).toBe(200);
    expect((await friend("red")).status).not.toBe(403);
    // Others are untouched, and unmuting lets Red talk again.
    expect((await room("blue")).status).toBe(200);
    await act({ action: "unmute", name: "Red" });
    // (Within a second of Red's last message: only the usual pace limit applies.)
    expect([200, 429]).toContain((await room("red")).status);
  });

  it("a ban stops PvP, matchmaking, tournaments, friend requests and posting", async () => {
    await act({ action: "ban", name: "Red", reason: "Bad language" });
    for (const res of [await room("red"), await battleChat("red"), await openPvp("red"), await search("red"), await friend("red"), await tournament("red")]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/banned: Bad language/);
    }
    await act({ action: "unban", name: "Red" });
    expect((await openPvp("red")).status).toBe(200);
  });

  it("a timed mute ends by itself; a permanent one doesn't", () => {
    const now = Date.UTC(2026, 9, 20);
    const s = { userId: red.id, username: "Red", mutedUntil: now + 3_600_000, banned: false, banReason: null, updatedAt: now, updatedBy: "Oak" };
    expect(blockedReason(s, "chat", now)).toMatch(/muted/);
    expect(blockedReason(s, "play", now)).toBeNull();
    expect(blockedReason(s, "chat", now + 3_600_001)).toBeNull();
    expect(blockedReason({ ...s, mutedUntil: 253402300799000 }, "chat", now + 1e12)).toMatch(/muted by a moderator\./);
  });
});

describe("feedback", () => {
  const send = (body: unknown, as?: string) => reportRoute.POST(req("/api/report", as, body));

  it("takes an idea, a bug or other, with the mode it's about, and shows it to moderators", async () => {
    expect((await send({ kind: "feedback", category: "idea", mode: "pokedle", message: "Add a hard mode!" }, "red")).status).toBe(200);
    expect((await send({ kind: "feedback", category: "bug", mode: "battle", message: "Moves froze", page: "/battle", extra: { recentErrors: [{ message: "TypeError: x" }] } })).status).toBe(200);
    const [bug, idea] = memoryReports();
    expect(idea).toMatchObject({ kind: "feedback", category: "idea", mode: "pokedle", reporter: "Red" });
    expect(bug).toMatchObject({ category: "bug", mode: "battle", page: "/battle", userAgent: "vitest", reporter: null });
    const { reports } = await (await admin.GET(req("/api/admin?tab=reports&category=idea", "oak"))).json();
    expect(reports.map((r: { message: string }) => r.message)).toEqual(["Add a hard mode!"]);
    // Resolving takes it off the open list.
    expect((await act({ action: "resolve", id: idea.id })).status).toBe(200);
    expect((await (await admin.GET(req("/api/admin?tab=reports&category=idea", "oak"))).json()).reports).toEqual([]);
  });

  it("is checked: categories and modes from the list, swears masked, abuse refused", async () => {
    expect((await send({ kind: "feedback", category: "rant", message: "hi" })).status).toBe(400);
    expect((await send({ kind: "feedback", mode: "nowhere", message: "hi" })).status).toBe(400);
    expect((await send({ kind: "feedback", category: "other", message: "   " })).status).toBe(400);
    expect((await send({ kind: "feedback", category: "other", message: "this shit is great" })).status).toBe(200);
    expect(memoryReports()[0].message).toBe("this ••• is great");
    expect((await send({ kind: "feedback", category: "other", message: "shit shit shit" })).status).toBe(400);
  });
});
