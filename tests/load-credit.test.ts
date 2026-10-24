import { describe, expect, it } from "vitest";
import { loadCredit, MAX_LOAD_CREDIT_MS } from "@/lib/server/session";

describe("loadCredit", () => {
  it("credits reported load time, clamped to the cap and real elapsed time", () => {
    expect(loadCredit(undefined, 5000)).toBe(0);
    expect(loadCredit(-5, 5000)).toBe(0);
    expect(loadCredit(1200, 5000)).toBe(1200);
    expect(loadCredit(1200, 800)).toBe(800);
    expect(loadCredit(60_000, 90_000)).toBe(MAX_LOAD_CREDIT_MS);
  });
});
