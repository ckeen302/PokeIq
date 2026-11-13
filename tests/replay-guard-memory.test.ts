import { afterEach, describe, expect, it, vi } from "vitest";
import { claimOnce, memoryClaims } from "@/lib/server/replay-guard";

describe("single-use claims on one instance (no database)", () => {
  afterEach(() => vi.useRealTimers());

  it("refuses a second claim, drops expired claims as new ones arrive, and stays quick when large", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    for (let i = 0; i < 60_000; i++) expect(await claimOnce(`t:${start}:${i}`)).toBe(true);
    expect(await claimOnce(`t:${start}:5`)).toBe(false);
    expect(await claimOnce(`t:${start}:59999`)).toBe(false);
    const held = memoryClaims();
    expect(held).toBeGreaterThanOrEqual(60_000);

    // Each claim used to scan the whole map once it held 50,000: now a claim costs about the same at any size.
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) await claimOnce(`u:${start}:${i}`);
    expect(performance.now() - t0).toBeLessThan(2_000);

    // Three hours on, the old claims are gone (and could be claimed again, as before).
    vi.setSystemTime(start + 3 * 60 * 60 * 1000 + 1);
    expect(await claimOnce(`v:${start}`)).toBe(true);
    expect(memoryClaims()).toBe(1);
    expect(await claimOnce(`t:${start}:5`)).toBe(true);
  });
});
