import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { searchUsers } from "@/lib/server/accounts";
import { GET } from "@/app/api/users/route";

// The dev file store, seeded in memory (nothing is written to disk by a search).
beforeAll(() => {
  const names = ["Ash", "ash_k", "Ashley", "asha-9", "Misty", "Brock", "a_b", "axb"];
  (globalThis as unknown as { __pokeiqAccounts: unknown }).__pokeiqAccounts = {
    users: names.map((username, i) => ({ id: `id-${i}`, username, passwordHash: "x", recoveryCodeHash: null, createdAt: "2026-01-01T00:00:00Z" })),
    sessions: [],
    progress: {},
  };
});

const get = (q: string, ip = "203.0.113.1") => GET(new NextRequest(`http://localhost/api/users?q=${encodeURIComponent(q)}`, { headers: { "x-forwarded-for": ip } }));

describe("user search", () => {
  it("finds names by prefix, case-insensitively, alphabetically, with _ taken literally", async () => {
    expect(await searchUsers("ash")).toEqual(["Ash", "ash_k", "asha-9", "Ashley"]);
    expect(await searchUsers("ASH_")).toEqual(["ash_k"]);
    expect(await searchUsers("a_")).toEqual(["a_b"]);
    expect(await searchUsers("ash", 2)).toEqual(["Ash", "ash_k"]);
    expect(await searchUsers("zzz")).toEqual([]);
  });

  it("answers names only, cached at the CDN, and ignores too-short or invalid queries", async () => {
    const res = await get("mi");
    expect(await res.json()).toEqual({ users: [{ username: "Misty" }] });
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=60/);
    for (const q of ["m", "", "a%", "a b", "x".repeat(21)]) expect(await (await get(q)).json()).toEqual({ users: [] });
  });

  it("is rate-limited per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await get("br", "198.51.100.7")).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
