import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A device that has never played PokéGuessr (no account, no device cookie)
 * gets its zero progress without a database read: the same answer the
 * database would give for a key with nothing logged.
 */

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
const reads = vi.fn();
vi.mock("@/lib/server/geo-round-scores", async (load) => {
  const real = await load<typeof import("@/lib/server/geo-round-scores")>();
  return {
    ...real,
    roundScoreStore: () => {
      reads();
      return real.roundScoreStore();
    },
  };
});

const { GET } = await import("@/app/api/geo/progress/route");
const { geoProgressFor } = await import("@/lib/server/geo-progress");

describe("/api/geo/progress for a device that has never played", () => {
  it("answers everything at zero without reading the database", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/geo/progress", { headers: { "x-forwarded-for": "10.1.2.3" } }));
    expect(res.status).toBe(200);
    expect(reads).not.toHaveBeenCalled();
    const body = await res.json();
    const fromStore = await geoProgressFor({ key: "geo-test-nothing-logged" }, { record: false });
    expect(body).toEqual({ ...JSON.parse(JSON.stringify(fromStore)), signedIn: false });
  });
});
