import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

/** The accounts service: "up" reads sessions as usual, "down" throws (an outage). */
const accounts = vi.hoisted(() => ({ mode: "up" as "up" | "down" }));
vi.mock("@/lib/server/accounts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/accounts")>();
  return {
    ...real,
    getSessionUser: async (hash: string) => {
      if (accounts.mode === "down") throw new Error("accounts down");
      return real.getSessionUser(hash);
    },
  };
});

const { POST } = await import("@/app/api/battle/match/route");
const { createSession, createUser } = await import("@/lib/server/accounts");
const { newSessionToken, newUserId } = await import("@/lib/server/auth");
const { AccountsUnavailable, newAnonId, rankedIdentity } = await import("@/lib/server/ranked");
const { cancelBattleSearch } = await import("@/lib/server/battle-engine/matchmaking");

let ip = 0;
/** A match request from its own address, signed in with `session` if given. */
function matchRequest(body: Record<string, unknown>, session?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` };
  if (session) headers.cookie = `pokeiq_session=${session}`;
  return new NextRequest("http://localhost/api/battle/match", { method: "POST", headers, body: JSON.stringify(body) });
}

async function signedIn(): Promise<string> {
  const id = newUserId();
  const created = await createUser({ id, username: `rk${id.slice(0, 8)}`, passwordHash: "none", recoveryCodeHash: null, createdAt: new Date().toISOString() });
  if (created === "taken") throw new Error("taken");
  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, id, new Date(Date.now() + 3_600_000));
  return token;
}

const ranked = (extra: Record<string, unknown> = {}) => ({ action: "search", settings: { format: "gen9randombattle", ranked: true }, name: "Red", ...extra });

beforeEach(() => {
  accounts.mode = "up";
});

describe("ranked battles need an account", () => {
  it("turns away a ranked search without a session (401), even with a valid anonymous id", async () => {
    const res = await POST(matchRequest(ranked({ rankedId: newAnonId() })));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Sign in to play ranked/);
  });

  it("answers 503 while the accounts service is down, never falling back to the anonymous id", async () => {
    const session = await signedIn();
    accounts.mode = "down";
    const res = await POST(matchRequest(ranked({ rankedId: newAnonId() }), session));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/"(ticket|code)"/);
    // The identity itself: an error, not "a:<id>", for a request that carries a session.
    await expect(rankedIdentity(matchRequest({}, session), newAnonId())).rejects.toBeInstanceOf(AccountsUnavailable);
  });

  it("queues a signed-in trainer", async () => {
    const session = await signedIn();
    const res = await POST(matchRequest(ranked(), session));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.status).toBe("waiting");
    await cancelBattleSearch("gen9randombattle", out.ticket, true);
    expect((await rankedIdentity(matchRequest({}, session), null))?.startsWith("u:")).toBe(true);
  });

  it("keeps casual searches open to guests, and to a signed-in trainer while accounts are down", async () => {
    const guest = await POST(matchRequest({ action: "search", settings: { format: "gen9randombattle" }, name: "Guest", rankedId: newAnonId() }));
    expect(guest.status).toBe(200);
    await cancelBattleSearch("gen9randombattle", (await guest.json()).ticket);
    const session = await signedIn();
    accounts.mode = "down";
    const res = await POST(matchRequest({ action: "search", settings: { format: "gen9randombattle" }, name: "Red", rankedId: newAnonId() }, session));
    expect(res.status).toBe(200);
    await cancelBattleSearch("gen9randombattle", (await res.json()).ticket);
  });
});
