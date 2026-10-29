import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/warm/route";

describe("GET /api/warm", () => {
  it("loads every heavy module and reports how long each took", async () => {
    // TCG prices from the captured fixture, as in the browser tests: no live API in unit tests.
    vi.stubEnv("POKEIQ_TCG_FIXTURE", "1");
    const res = await GET(new NextRequest("http://localhost/api/warm"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ms: Record<string, number>; failed?: string[] };
    expect(body.failed, "modules that failed to load").toBeUndefined();
    expect(body.ok).toBe(true);
    expect(Object.keys(body.ms).sort()).toEqual(["accounts", "battle", "connections", "geo", "geoGuess", "pikadoku", "pokedle", "ranked", "tcg"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }, 120_000);
});
