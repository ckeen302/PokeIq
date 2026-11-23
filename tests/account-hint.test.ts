import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { UserRecord } from "@/lib/server/accounts";
import { SIGNED_IN_HINT_COOKIE, SITE_FLAGS_MAX_AGE_MS, freshSiteFlags, hasSignedInHint } from "@/lib/account-hint";

/**
 * A visitor who has never signed in doesn't ask the server who they are on
 * every page load: the signed-in hint cookie travels with the session cookie,
 * and /api/auth/me keeps it in step with the session.
 */

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const users = new Map<string, UserRecord>();
let sessionUser: { id: string; username: string; createdAt: string } | null = null;
vi.mock("@/lib/server/accounts", () => ({
  accountsEnabled: () => true,
  toPublicUser: (u: UserRecord) => ({ id: u.id, username: u.username, createdAt: u.createdAt }),
  findUserByName: async (name: string) => users.get(name.toLowerCase()) ?? null,
  createSession: async () => {},
  getSessionUser: async () => sessionUser,
  loadProgress: async () => null,
}));
vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return { ...real, verifyPassword: async (p: string, stored: string) => stored === `plain:${p}`, burnPasswordCheck: async () => {} };
});
vi.mock("@/lib/server/avatars", () => ({ ownAvatar: async () => undefined }));
vi.mock("@/lib/server/email/config", () => ({ emailEnabled: () => false }));

const { resetRateLimits } = await import("@/lib/server/rate-limit");
const login = await import("@/app/api/auth/login/route");
const logout = await import("@/app/api/auth/logout/route");
const me = await import("@/app/api/auth/me/route");

const headers = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": "10.0.0.9" };
const hintOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SIGNED_IN_HINT_COOKIE}=`));

beforeEach(() => {
  users.clear();
  resetRateLimits();
  sessionUser = null;
});

describe("the signed-in hint cookie", () => {
  it("is set with the session on sign-in, readable by the page (not HTTP-only), and cleared on sign-out", async () => {
    users.set("ash", { id: "id-ash", username: "Ash", passwordHash: "plain:pikachu-pikachu", createdAt: "2026-01-01T00:00:00Z" } as UserRecord);
    const res = await login.POST(new NextRequest("http://localhost:3000/api/auth/login", { method: "POST", headers, body: JSON.stringify({ username: "Ash", password: "pikachu-pikachu" }) }));
    expect(res.status).toBe(200);
    const hint = hintOf(res)!;
    expect(hint).toMatch(new RegExp(`^${SIGNED_IN_HINT_COOKIE}=1;`));
    expect(hint.toLowerCase()).not.toContain("httponly");
    const out = await logout.POST(new NextRequest("http://localhost:3000/api/auth/logout", { method: "POST", headers }));
    expect(hintOf(out)).toMatch(/Max-Age=0/);
  });

  it("/api/auth/me sets it for a session from before it existed, and clears it once the session has ended", async () => {
    sessionUser = { id: "id-ash", username: "Ash", createdAt: "2026-01-01T00:00:00Z" };
    const session = `pokeiq_session=${"a".repeat(64)}`;
    const old = await me.GET(new NextRequest("http://localhost:3000/api/auth/me", { headers: { cookie: session } }));
    expect((await old.json()).user.username).toBe("Ash");
    expect(hintOf(old)).toMatch(new RegExp(`^${SIGNED_IN_HINT_COOKIE}=1;`));
    // Already there: nothing to set.
    const steady = await me.GET(new NextRequest("http://localhost:3000/api/auth/me", { headers: { cookie: `${session}; ${SIGNED_IN_HINT_COOKIE}=1` } }));
    expect(hintOf(steady)).toBeUndefined();
    // The session ended (expired, or signed out elsewhere): the hint goes, so the browser stops asking.
    sessionUser = null;
    const ended = await me.GET(new NextRequest("http://localhost:3000/api/auth/me", { headers: { cookie: `${session}; ${SIGNED_IN_HINT_COOKIE}=1` } }));
    expect((await ended.json()).user).toBeNull();
    expect(hintOf(ended)).toMatch(/Max-Age=0/);
    // A guest with no hint gets no cookie at all.
    const guest = await me.GET(new NextRequest("http://localhost:3000/api/auth/me"));
    expect(guest.headers.getSetCookie()).toEqual([]);
  });

  it("is read from document.cookie exactly", () => {
    expect(hasSignedInHint(`a=b; ${SIGNED_IN_HINT_COOKIE}=1; c=d`)).toBe(true);
    expect(hasSignedInHint(`${SIGNED_IN_HINT_COOKIE}=1`)).toBe(true);
    expect(hasSignedInHint(`${SIGNED_IN_HINT_COOKIE}=0`)).toBe(false);
    expect(hasSignedInHint(`x${SIGNED_IN_HINT_COOKIE}=1`)).toBe(false);
    expect(hasSignedInHint("")).toBe(false);
  });
});

describe("the site-wide answers a guest's browser keeps", () => {
  const now = Date.UTC(2026, 10, 23, 12);
  it("are used while recent, and asked for again after SITE_FLAGS_MAX_AGE_MS", () => {
    const kept = (at: number) => JSON.stringify({ enabled: true, emailEnabled: false, at });
    expect(freshSiteFlags(kept(now - 1000), now)).toEqual({ enabled: true, emailEnabled: false, at: now - 1000 });
    expect(freshSiteFlags(kept(now - SITE_FLAGS_MAX_AGE_MS), now)).toBeNull();
    // A clock set back: asked for again.
    expect(freshSiteFlags(kept(now + 60_000), now)).toBeNull();
  });

  it("anything missing or malformed means asking", () => {
    expect(freshSiteFlags(null, now)).toBeNull();
    expect(freshSiteFlags("not json", now)).toBeNull();
    expect(freshSiteFlags(JSON.stringify({ enabled: "yes", emailEnabled: false, at: now }), now)).toBeNull();
    expect(freshSiteFlags(JSON.stringify({ enabled: true, at: now }), now)).toBeNull();
  });
});
