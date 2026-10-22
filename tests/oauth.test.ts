import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type { IdentityRecord, UserRecord } from "@/lib/server/accounts";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});

// In-memory accounts so the routes run without Supabase or the dev file store.
const db = vi.hoisted(() => ({
  users: [] as UserRecord[],
  identities: [] as IdentityRecord[],
  sessions: new Map<string, string>(),
}));

vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => null }));
vi.mock("@/lib/server/accounts", async (orig) => {
  const real = await orig<typeof import("@/lib/server/accounts")>();
  return {
    ...real,
    accountsEnabled: () => true,
    findIdentity: async (p: string, id: string) => db.identities.find((i) => i.provider === p && i.providerUserId === id) ?? null,
    identitiesOf: async (profileId: string) => db.identities.filter((i) => i.profileId === profileId),
    insertIdentity: async (rec: IdentityRecord) => {
      if (db.identities.some((i) => (i.provider === rec.provider && i.providerUserId === rec.providerUserId) || (i.profileId === rec.profileId && i.provider === rec.provider))) return "conflict";
      db.identities.push(rec);
      return rec;
    },
    touchIdentity: async (p: string, id: string, email: string | null) => {
      const rec = db.identities.find((i) => i.provider === p && i.providerUserId === id);
      if (rec) rec.email = email;
    },
    deleteIdentity: async (profileId: string, p: string) => {
      db.identities = db.identities.filter((i) => !(i.profileId === profileId && i.provider === p));
    },
    findUserRecordById: async (id: string) => db.users.find((u) => u.id === id) ?? null,
    findUserByName: async (name: string) => db.users.find((u) => u.username.toLowerCase() === name.toLowerCase()) ?? null,
    createUser: async (u: UserRecord) => {
      if (db.users.some((x) => x.username.toLowerCase() === u.username.toLowerCase())) return "taken";
      db.users.push(u);
      return u;
    },
    deleteProfile: async (id: string) => {
      db.users = db.users.filter((u) => u.id !== id);
    },
    createSession: async (hash: string, userId: string) => {
      db.sessions.set(hash, userId);
    },
    getSessionUser: async (hash: string) => {
      const u = db.users.find((x) => x.id === db.sessions.get(hash));
      return u ? real.toPublicUser(u) : null;
    },
  };
});

const oauth = await import("@/lib/server/oauth");
const { setSanction, clearMemoryModeration } = await import("@/lib/server/moderation");
const { hasPassword, NO_PASSWORD, hashPassword, newSessionToken, SESSION_COOKIE } = await import("@/lib/server/auth");
const { toPublicUser } = await import("@/lib/server/accounts");
const { enabledOAuthProviders, oauthErrorMessage } = await import("@/lib/oauth");
const callbackRoute = await import("@/app/api/auth/oauth/callback/route");
const startRoute = await import("@/app/api/auth/oauth/[provider]/route");
const signupRoute = await import("@/app/api/auth/oauth/signup/route");
const identitiesRoute = await import("@/app/api/auth/oauth/identities/route");
const meRoute = await import("@/app/api/auth/me/route");

const SUPA = "https://example.supabase.co";
const SITE = "http://localhost:3000";
const EMAIL = "ash.private@example.com";
let ipCounter = 0;

function supabaseUser(provider: string, sub: string, extra: Record<string, unknown> = {}) {
  return {
    id: "supabase-user",
    identities: [{ id: sub, provider, identity_data: { sub, email: EMAIL, email_verified: true, full_name: "Ash Ketchum", ...extra } }],
  };
}

/** Mocks the Supabase token exchange (and the logout that follows). */
function mockSupabase(user: unknown, ok = true) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/logout")) return new Response(null, { status: 204 });
    return ok ? Response.json({ access_token: "sb-access", refresh_token: "sb-refresh", user }) : Response.json({ error: "bad" }, { status: 400 });
  });
  return calls;
}

function startCookie(provider: "discord" | "google", intent: "signin" | "link" = "signin") {
  const { cookie, authorizeUrl } = oauth.startFlow(provider, intent, { siteUrl: SITE, supabaseUrl: SUPA });
  const state = new URL(new URL(authorizeUrl).searchParams.get("redirect_to")!).searchParams.get("state")!;
  return { cookie, state, authorizeUrl };
}

function callback(query: string, cookies: Record<string, string>) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return callbackRoute.GET(
    new NextRequest(`${SITE}/api/auth/oauth/callback?${query}`, { headers: { cookie, "x-forwarded-for": `10.0.0.${++ipCounter}` } })
  );
}

function makeUser(username: string, passwordHash = NO_PASSWORD): UserRecord {
  const u: UserRecord = { id: crypto.randomUUID(), username, passwordHash, recoveryCodeHash: null, createdAt: new Date().toISOString() };
  db.users.push(u);
  return u;
}

function sessionFor(userId: string): string {
  const { token, tokenHash } = newSessionToken();
  db.sessions.set(tokenHash, userId);
  return token;
}

const identity = (provider: "discord" | "google", id: string, email: string | null = EMAIL) => ({
  provider,
  providerUserId: id,
  email,
  displayName: "Ash",
});

beforeEach(() => {
  db.users = [];
  db.identities = [];
  db.sessions.clear();
  clearMemoryModeration();
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  vi.unstubAllGlobals();
});

afterAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.unstubAllGlobals();
});

describe("state and PKCE", () => {
  it("uses an S256 challenge (RFC 7636 test vector)", () => {
    expect(oauth.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("sends Supabase the challenge, never the verifier, and a fixed redirect", () => {
    const { authorizeUrl, cookie, state } = startCookie("discord");
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${SUPA}/auth/v1/authorize`);
    expect(url.searchParams.get("provider")).toBe("discord");
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("redirect_to")).toBe(`${SITE}/api/auth/oauth/callback?state=${state}`);
    const flow = oauth.verifyFlow(cookie, state)!;
    expect(flow.v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(flow.v).digest("base64url"));
    expect(authorizeUrl).not.toContain(flow.v);
    expect(cookie).not.toContain(flow.v); // sealed, not just signed
  });

  it("rejects a wrong state, a tampered or foreign cookie, and an expired flow", () => {
    const { cookie, state } = startCookie("google");
    expect(oauth.verifyFlow(cookie, state)?.p).toBe("google");
    expect(oauth.verifyFlow(cookie, `${state}x`)).toBeNull();
    expect(oauth.verifyFlow(cookie, startCookie("google").state)).toBeNull();
    expect(oauth.verifyFlow(cookie, null)).toBeNull();
    expect(oauth.verifyFlow(undefined, state)).toBeNull();
    const bytes = Buffer.from(cookie, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(oauth.verifyFlow(bytes.toString("base64url"), state)).toBeNull();
    expect(oauth.verifyFlow(cookie, state, Date.now() + oauth.FLOW_TTL_MS + 1)).toBeNull();
    // A pending-signup cookie can't stand in for a flow cookie.
    expect(oauth.verifyFlow(oauth.sealSignup(identity("google", "1"), "Ash"), state)).toBeNull();
  });

  it("exchanges the code with the verifier and the apikey header, server-side", async () => {
    const calls = mockSupabase(supabaseUser("discord", "42"));
    const res = await oauth.exchangeCode("the-code", "the-verifier", { url: SUPA, key: "service-role-secret" });
    expect(res?.accessToken).toBe("sb-access");
    expect(calls[0].url).toBe(`${SUPA}/auth/v1/token?grant_type=pkce`);
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("service-role-secret");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ auth_code: "the-code", code_verifier: "the-verifier" });
  });

  it("the callback refuses a state mismatch without calling Supabase", async () => {
    const calls = mockSupabase(supabaseUser("discord", "42"));
    const { cookie } = startCookie("discord");
    const res = await callback("state=forged&code=abc", { pokeiq_oauth: cookie });
    expect(res.headers.get("location")).toBe(`${SITE}/login?oauth_error=expired`);
    expect(calls).toHaveLength(0);
    const noCookie = await callback("state=x&code=abc", {});
    expect(noCookie.headers.get("location")).toBe(`${SITE}/login?oauth_error=expired`);
  });

  it("the start route sets an httpOnly, SameSite=Lax flow cookie scoped to the OAuth routes", async () => {
    const res = await startRoute.GET(new NextRequest(`${SITE}/api/auth/oauth/discord`, { headers: { "x-forwarded-for": "10.1.0.1" } }), {
      params: Promise.resolve({ provider: "discord" }),
    });
    expect(res.headers.get("location")).toMatch(/^https:\/\/example\.supabase\.co\/auth\/v1\/authorize\?/);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/pokeiq_oauth=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/api\/auth\/oauth/);
    const bad = await startRoute.GET(new NextRequest(`${SITE}/api/auth/oauth/github`), { params: Promise.resolve({ provider: "github" }) });
    expect(bad.headers.get("location")).toBe(`${SITE}/login?oauth_error=unavailable`);
  });

  it("only shows known error codes and enabled providers", () => {
    expect(oauthErrorMessage("<script>")).toBeNull();
    expect(oauthErrorMessage("toString")).toBeNull();
    expect(oauthErrorMessage("banned")).toMatch(/banned/);
    expect(enabledOAuthProviders(undefined)).toEqual(["discord", "google"]);
    expect(enabledOAuthProviders("discord")).toEqual(["discord"]);
    expect(enabledOAuthProviders("")).toEqual([]);
  });
});

describe("provider identity", () => {
  it("picks the requested provider's identity and keeps only verified emails", () => {
    const merged = {
      identities: [
        { id: "g-1", provider: "google", identity_data: { sub: "g-1", email: "A@x.com", email_verified: true, name: "A" } },
        { id: "d-1", provider: "discord", identity_data: { sub: "d-1", email: "b@x.com", email_verified: false, custom_claims: { global_name: "Misty" } } },
      ],
    };
    expect(oauth.identityFromUser(merged, "google")).toEqual({ provider: "google", providerUserId: "g-1", email: "a@x.com", displayName: "A" });
    expect(oauth.identityFromUser(merged, "discord")).toEqual({ provider: "discord", providerUserId: "d-1", email: null, displayName: "Misty" });
    expect(oauth.identityFromUser({ identities: [] }, "discord")).toBeNull();
    expect(oauth.identityFromUser(null, "discord")).toBeNull();
  });

  it("suggests clean, valid, unused trainer names", async () => {
    expect(oauth.sanitizeUsername("Ash Ketchum")).toBe("Ash_Ketchum");
    expect(oauth.sanitizeUsername("Pokémon Måster!!")).toBe("Pokemon_Master");
    expect(oauth.sanitizeUsername("✨")).toBe("Trainer");
    expect(oauth.sanitizeUsername(null)).toBe("Trainer");
    expect(oauth.sanitizeUsername("a".repeat(40))).toHaveLength(20);
    const taken = new Set(["ash"]);
    const name = await oauth.uniqueUsername("Ash", async (n) => taken.has(n.toLowerCase()));
    expect(name).toMatch(/^Ash\d{3}$/);
    expect(await oauth.uniqueUsername("Trainer", async () => false)).toMatch(/^Trainer\d+$/);
  });
});

describe("identity -> profile", () => {
  it("signs an existing identity in to its profile (and refreshes the email)", async () => {
    const u = makeUser("Brock");
    db.identities.push({ provider: "discord", providerUserId: "7", profileId: u.id, email: "old@x.com", createdAt: "", updatedAt: "" });
    expect(await oauth.resolveSignIn(identity("discord", "7"))).toEqual({ kind: "signed_in", profileId: u.id });
    expect(db.identities[0].email).toBe(EMAIL);
    expect(await oauth.resolveSignIn(identity("discord", "8"))).toEqual({ kind: "new" });
    expect(await oauth.resolveSignIn(identity("google", "7"))).toEqual({ kind: "new" });
  });

  it("refuses banned trainers", async () => {
    const u = makeUser("TeamRocket");
    db.identities.push({ provider: "google", providerUserId: "9", profileId: u.id, email: null, createdAt: "", updatedAt: "" });
    await setSanction({ userId: u.id, username: u.username, mutedUntil: null, banned: true, banReason: "cheating", updatedAt: Date.now(), updatedBy: "mod" });
    expect(await oauth.resolveSignIn(identity("google", "9"))).toEqual({ kind: "error", code: "banned" });

    mockSupabase(supabaseUser("google", "9"));
    const { cookie, state } = startCookie("google");
    const res = await callback(`state=${state}&code=abc`, { pokeiq_oauth: cookie });
    expect(res.headers.get("location")).toBe(`${SITE}/login?oauth_error=banned`);
    expect(res.headers.get("set-cookie")).not.toMatch(new RegExp(`${SESSION_COOKIE}=[0-9a-f]`));
  });

  it("creates a new trainer only after a name and the 13+ confirmation", async () => {
    const pending = oauth.openSignup(oauth.sealSignup(identity("discord", "100"), "Ash"))!;
    expect(oauth.signupSchema.safeParse({ username: "Ash", ageConfirmed: false }).success).toBe(false);
    expect(oauth.signupSchema.safeParse({ username: "Ash" }).success).toBe(false);
    expect(oauth.signupSchema.safeParse({ username: "Ash", ageConfirmed: "yes" }).success).toBe(false);
    expect(oauth.signupSchema.safeParse({ username: "a b", ageConfirmed: true }).success).toBe(false);
    expect(oauth.signupSchema.safeParse({ username: "Ash", ageConfirmed: true }).success).toBe(true);

    makeUser("Taken");
    expect(await oauth.completeSignup(pending, "Taken")).toBe("taken");
    const user = await oauth.completeSignup(pending, "Ash");
    expect(user).toMatchObject({ username: "Ash", passwordHash: NO_PASSWORD, recoveryCodeHash: null });
    expect(hasPassword((user as UserRecord).passwordHash)).toBe(false);
    expect(db.identities).toEqual([expect.objectContaining({ provider: "discord", providerUserId: "100", profileId: (user as UserRecord).id, email: EMAIL })]);
    expect(await oauth.completeSignup(pending, "Ash2")).toBe("exists");
  });

  it("runs the whole first sign-in: callback -> pick a name -> signed in", async () => {
    mockSupabase(supabaseUser("discord", "555"));
    const { cookie, state } = startCookie("discord");
    const res = await callback(`state=${state}&code=abc`, { pokeiq_oauth: cookie });
    expect(res.headers.get("location")).toBe(`${SITE}/login/oauth`);
    const signup = /pokeiq_oauth_signup=([^;]+)/.exec(res.headers.get("set-cookie")!)![1];
    expect(signup).not.toContain(EMAIL);
    expect(Buffer.from(signup, "base64url").toString("latin1")).not.toContain(EMAIL);

    const headers = { cookie: `pokeiq_oauth_signup=${signup}`, "content-type": "application/json", "x-forwarded-for": "10.2.0.1" };
    const info = await signupRoute.GET(new NextRequest(`${SITE}/api/auth/oauth/signup`, { headers }));
    const infoBody = await info.json();
    expect(infoBody).toEqual({ provider: "discord", suggestion: "Ash_Ketchum" });

    const noAge = await signupRoute.POST(new NextRequest(`${SITE}/api/auth/oauth/signup`, { method: "POST", headers, body: JSON.stringify({ username: "Ash_Ketchum" }) }));
    expect(noAge.status).toBe(400);
    expect((await noAge.json()).error).toMatch(/13/);
    expect(db.users).toHaveLength(0);

    const ok = await signupRoute.POST(
      new NextRequest(`${SITE}/api/auth/oauth/signup`, { method: "POST", headers, body: JSON.stringify({ username: "Ash_Ketchum", ageConfirmed: true }) })
    );
    expect(ok.status).toBe(201);
    const text = await ok.clone().text();
    expect(text).not.toContain(EMAIL);
    expect(ok.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=[0-9a-f]{64}`));

    // Next time, the same Discord account signs straight in.
    mockSupabase(supabaseUser("discord", "555"));
    const again = startCookie("discord");
    const back = await callback(`state=${again.state}&code=abc`, { pokeiq_oauth: again.cookie });
    expect(back.headers.get("location")).toBe(`${SITE}/trainer`);
    expect(back.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=[0-9a-f]{64}`));
  });

  it("links to the signed-in trainer, and refuses an identity owned by someone else", async () => {
    const misty = makeUser("Misty", await hashPassword("password1"));
    const brock = makeUser("Brock");
    db.identities.push({ provider: "google", providerUserId: "b-g", profileId: brock.id, email: null, createdAt: "", updatedAt: "" });

    expect(await oauth.linkIdentity(misty.id, identity("discord", "m-d"))).toBe("linked");
    expect(await oauth.linkIdentity(misty.id, identity("discord", "m-d"))).toBe("linked"); // idempotent
    expect(await oauth.linkIdentity(misty.id, identity("discord", "other"))).toBe("already_linked");
    expect(await oauth.linkIdentity(misty.id, identity("google", "b-g"))).toBe("linked_elsewhere");
    expect(db.identities.find((i) => i.providerUserId === "b-g")?.profileId).toBe(brock.id);

    // Through the callback, with Misty's session.
    mockSupabase(supabaseUser("google", "b-g"));
    const flow = startCookie("google", "link");
    const res = await callback(`state=${flow.state}&code=abc`, { pokeiq_oauth: flow.cookie, [SESSION_COOKIE]: sessionFor(misty.id) });
    expect(res.headers.get("location")).toBe(`${SITE}/trainer?oauth_error=linked_elsewhere`);

    mockSupabase(supabaseUser("google", "m-g"));
    const flow2 = startCookie("google", "link");
    const ok = await callback(`state=${flow2.state}&code=abc`, { pokeiq_oauth: flow2.cookie, [SESSION_COOKIE]: sessionFor(misty.id) });
    expect(ok.headers.get("location")).toBe(`${SITE}/trainer?linked=google`);

    mockSupabase(supabaseUser("discord", "x"));
    const flow3 = startCookie("discord", "link");
    const anon = await callback(`state=${flow3.state}&code=abc`, { pokeiq_oauth: flow3.cookie });
    expect(anon.headers.get("location")).toBe(`${SITE}/trainer?oauth_error=signin_required`);
  });

  it("unlinks only while another way to sign in remains", async () => {
    const oauthOnly = makeUser("Gary");
    db.identities.push({ provider: "discord", providerUserId: "g-d", profileId: oauthOnly.id, email: null, createdAt: "", updatedAt: "" });
    expect(await oauth.unlinkIdentity(oauthOnly.id, "discord")).toBe("last_method");
    expect(await oauth.unlinkIdentity(oauthOnly.id, "google")).toBe("not_linked");
    db.identities.push({ provider: "google", providerUserId: "g-g", profileId: oauthOnly.id, email: null, createdAt: "", updatedAt: "" });
    expect(await oauth.unlinkIdentity(oauthOnly.id, "discord")).toBe("unlinked");
    expect(await oauth.unlinkIdentity(oauthOnly.id, "google")).toBe("last_method");

    const withPassword = makeUser("Erika", await hashPassword("password1"));
    db.identities.push({ provider: "discord", providerUserId: "e-d", profileId: withPassword.id, email: null, createdAt: "", updatedAt: "" });
    expect(await oauth.unlinkIdentity(withPassword.id, "discord")).toBe("unlinked");
    expect(db.identities.some((i) => i.providerUserId === "e-d")).toBe(false);
  });
});

describe("emails stay private", () => {
  it("only the owner's own connected-accounts response carries their email", async () => {
    const u = makeUser("Dawn", await hashPassword("password1"));
    db.identities.push({ provider: "google", providerUserId: "d-g", profileId: u.id, email: EMAIL, createdAt: "2026-01-01", updatedAt: "" });
    const token = sessionFor(u.id);
    const req = (url: string) => new NextRequest(`${SITE}${url}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

    const own = await (await identitiesRoute.GET(req("/api/auth/oauth/identities"))).json();
    expect(own).toEqual({ identities: [{ provider: "google", email: EMAIL, linkedAt: "2026-01-01" }], hasPassword: true });

    const anon = await identitiesRoute.GET(new NextRequest(`${SITE}/api/auth/oauth/identities`));
    expect(anon.status).toBe(401);
    expect(await anon.text()).not.toContain(EMAIL);

    const me = await meRoute.GET(req("/api/auth/me"));
    expect(await me.text()).not.toContain(EMAIL);
    expect(JSON.stringify(toPublicUser(u))).not.toContain(EMAIL);
    expect(Object.keys(toPublicUser(u)).sort()).toEqual(["createdAt", "id", "username"]);
  });
});
