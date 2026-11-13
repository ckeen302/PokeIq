import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { UserRecord } from "@/lib/server/accounts";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

// Accounts in memory, and instant password hashing: these tests make hundreds of attempts.
const users = new Map<string, UserRecord>();
vi.mock("@/lib/server/accounts", () => ({
  accountsEnabled: () => true,
  toPublicUser: (u: UserRecord) => ({ id: u.id, username: u.username, createdAt: u.createdAt }),
  findUserByName: async (name: string) => users.get(name.toLowerCase()) ?? null,
  createUser: async (u: UserRecord) => (users.has(u.username.toLowerCase()) ? "taken" : (users.set(u.username.toLowerCase(), u), u)),
  createSession: async () => {},
  deleteUserSessions: async () => {},
  updateCredentials: async (id: string, changes: Partial<UserRecord>) => {
    for (const u of users.values()) if (u.id === id) Object.assign(u, changes);
  },
}));
vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return {
    ...real,
    hashPassword: async (p: string) => `plain:${p}`,
    verifyPassword: async (p: string, stored: string) => stored === `plain:${p}`,
    burnPasswordCheck: async () => {},
  };
});
vi.mock("@/lib/server/email/service", () => ({ optInAtSignup: async () => "skipped" }));

const { resetRateLimits } = await import("@/lib/server/rate-limit");
const { FAILURE_BURST, SIGNUP_BURST } = await import("@/lib/server/auth-route");
const { NO_PASSWORD, hashRecoveryCode } = await import("@/lib/server/auth");
const login = await import("@/app/api/auth/login/route");
const register = await import("@/app/api/auth/register/route");
const recover = await import("@/app/api/auth/recover/route");

const CODE = "ABCD-EFGH-JKMN-PQRS";
function trainer(name: string, password = "right-password"): UserRecord {
  const u = { id: `id-${name}`, username: name, passwordHash: password === NO_PASSWORD ? NO_PASSWORD : `plain:${password}`, recoveryCodeHash: hashRecoveryCode(CODE), createdAt: "2026-01-01T00:00:00Z" } as UserRecord;
  users.set(name.toLowerCase(), u);
  return u;
}
function post(route: { POST: (r: NextRequest) => Promise<Response> }, path: string, body: unknown, ip = "10.0.0.1") {
  const headers = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": ip };
  return route.POST(new NextRequest(`http://localhost:3000/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}
const signIn = (username: string, password: string, ip?: string) => post(login, "login", { username, password }, ip);
const signUp = (username: string, ip?: string, password = "long-enough-password") => post(register, "register", { username, password }, ip);
const reset = (username: string, recoveryCode: string, ip?: string) => post(recover, "recover", { username, recoveryCode, newPassword: "a-brand-new-password" }, ip);

let now = Date.UTC(2026, 10, 13, 12);
beforeEach(() => {
  users.clear();
  resetRateLimits();
  now = Date.UTC(2026, 10, 13, 12);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("sign-in limits", () => {
  it("a whole school behind one address can sign in: right passwords don't count", async () => {
    for (let i = 0; i < 200; i++) trainer(`kid${i}`);
    for (let i = 0; i < 200; i++) expect((await signIn(`kid${i}`, "right-password")).status).toBe(200);
  });

  it("a classroom's typos don't lock the address: a burst of wrong tries fits, and the right password still works", async () => {
    for (let i = 0; i < 30; i++) trainer(`kid${i}`);
    for (let i = 0; i < 30; i++) expect((await signIn(`kid${i}`, "oops")).status).toBe(401);
    for (let i = 0; i < 30; i++) expect((await signIn(`kid${i}`, "right-password")).status).toBe(200);
  });

  it("one account: ten wrong tries, then refused from any address, then one try a minute", async () => {
    trainer("Red");
    trainer("Blue");
    for (let i = 0; i < 10; i++) expect((await signIn("Red", "guess", `10.9.${i}.1`)).status).toBe(401);
    // Even the right password waits, from a new address, in any letter case.
    expect((await signIn("Red", "right-password", "10.77.0.1")).status).toBe(429);
    expect((await signIn(" RED ", "guess", "10.78.0.1")).status).toBe(429);
    // Other accounts are untouched.
    expect((await signIn("Blue", "right-password", "10.9.0.1")).status).toBe(200);
    now += 61_000;
    expect((await signIn("Red", "guess", "10.79.0.1")).status).toBe(401);
    expect((await signIn("Red", "guess", "10.80.0.1")).status).toBe(429);
  });

  it("a right password gives the account its try back", async () => {
    trainer("Red");
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 9; i++) expect((await signIn("Red", "guess", `10.${round}.${i}.1`)).status).toBe(401);
      now += 9 * 60_000;
      expect((await signIn("Red", "right-password", "10.50.0.1")).status).toBe(200);
    }
  });

  it("one address guessing across many accounts: the burst, then ten a minute", async () => {
    const burst = 10 * FAILURE_BURST;
    let refused = 0;
    for (let i = 0; i < burst + 20; i++) if ((await signIn(`victim${i}`, "Password1")).status === 429) refused++;
    expect(refused).toBe(20);
    now += 60_000;
    let allowed = 0;
    for (let i = 0; i < 30; i++) if ((await signIn(`more${i}`, "Password1")).status === 401) allowed++;
    expect(allowed).toBe(10);
    // Another address isn't affected.
    expect((await signIn("someone", "Password1", "10.0.0.2")).status).toBe(401);
  });

  it("parallel guesses can't share a token", async () => {
    trainer("Red");
    const all = await Promise.all(Array.from({ length: 40 }, (_, i) => signIn("Red", `guess${i}`, `10.3.${i}.1`)));
    expect(all.filter((r) => r.status === 401)).toHaveLength(10);
    expect(all.filter((r) => r.status === 429)).toHaveLength(30);
  });
});

describe("sign-in errors don't say whether an account exists", () => {
  it("an unknown name, a wrong password and an account with no password answer alike", async () => {
    trainer("Red");
    trainer("Discordian", NO_PASSWORD);
    const answers = [];
    for (const [name, password] of [["Red", "wrong"], ["nobody-here", "wrong"], ["Discordian", "wrong"], ["Discordian", NO_PASSWORD]]) {
      const res = await signIn(name, password);
      answers.push({ status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") });
    }
    for (const a of answers) expect(a).toEqual({ status: 401, body: { error: "Wrong trainer name or password." }, cookie: null });
  });

  it("the per-account limit answers alike for a name that exists and one that doesn't", async () => {
    trainer("Red");
    const out: Record<string, number[]> = { Red: [], Ghost: [] };
    for (const name of ["Red", "Ghost"]) for (let i = 0; i < 12; i++) out[name].push((await signIn(name, "guess", `10.${name.length}.${i}.1`)).status);
    expect(out.Red).toEqual(out.Ghost);
    expect(out.Red.slice(10)).toEqual([429, 429]);
  });

  it("a password reset: an unknown name and a wrong code answer alike", async () => {
    trainer("Red");
    const a = await reset("Red", "WXYZ-WXYZ-WXYZ-WXYZ");
    const b = await reset("nobody-here", "WXYZ-WXYZ-WXYZ-WXYZ");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });
});

describe("password-reset limits", () => {
  it("one account: five wrong codes, then refused from any address; the right code works before that and costs nothing", async () => {
    trainer("Red");
    for (let i = 0; i < 4; i++) expect((await reset("Red", "WXYZ-WXYZ-WXYZ-WXYZ", `10.4.${i}.1`)).status).toBe(401);
    const ok = await reset("Red", CODE, "10.4.9.1");
    expect(ok.status).toBe(200);
    const fresh = (await ok.json()).recoveryCode as string;
    expect(fresh).not.toBe(CODE);
    // The old code is spent; the account now has one try left of its five, plus the one the right code gave back.
    expect((await reset("Red", CODE, "10.4.10.1")).status).toBe(401);
    expect((await reset("Red", CODE, "10.4.11.1")).status).toBe(429);
    expect((await reset("Red", fresh, "10.4.12.1")).status).toBe(429);
  });

  it("one address: a burst of wrong codes across accounts, then five a minute", async () => {
    let refused = 0;
    for (let i = 0; i < 5 * FAILURE_BURST + 10; i++) if ((await reset(`victim${i}`, "WXYZ-WXYZ-WXYZ-WXYZ")).status === 429) refused++;
    expect(refused).toBe(10);
    now += 60_000;
    let allowed = 0;
    for (let i = 0; i < 20; i++) if ((await reset(`more${i}`, "WXYZ-WXYZ-WXYZ-WXYZ")).status === 401) allowed++;
    expect(allowed).toBe(5);
  });
});

describe("sign-up limits", () => {
  it("a classroom signs up together from one address; after that, one account a minute", async () => {
    for (let i = 0; i < SIGNUP_BURST; i++) expect((await signUp(`pupil${i}`)).status).toBe(201);
    expect((await signUp("onemore")).status).toBe(429);
    expect(users.has("onemore")).toBe(false);
    now += 61_000;
    expect((await signUp("onemore")).status).toBe(201);
    expect((await signUp("andagain")).status).toBe(429);
    // Another address has its own allowance.
    expect((await signUp("elsewhere", "10.0.0.2")).status).toBe(201);
  });

  it("a taken name or a short password doesn't use up an account", async () => {
    trainer("Red");
    for (let i = 0; i < 30; i++) expect((await signUp("Red")).status).toBe(409);
    for (let i = 0; i < 30; i++) expect((await signUp(`pupil${i}`, undefined, "short")).status).toBe(400);
    for (let i = 0; i < SIGNUP_BURST; i++) expect((await signUp(`pupil${i}`)).status).toBe(201);
  });

  it("tries of any kind are limited too", async () => {
    trainer("Red");
    let refused = 0;
    for (let i = 0; i < SIGNUP_BURST * 3 + 15; i++) if ((await signUp("Red")).status === 429) refused++;
    expect(refused).toBe(15);
  });
});
