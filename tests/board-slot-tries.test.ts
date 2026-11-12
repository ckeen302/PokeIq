import { describe, expect, it, vi } from "vitest";

const tried: string[] = [];
const taken = new Set<string>();
vi.mock("@/lib/server/replay-guard", () => ({
  claimOnce: async (key: string) => {
    tried.push(key);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  },
}));

const { BOARD_SLOTS_PER_ADDRESS, claimBoardSlot } = await import("@/lib/server/board-guard");

describe("board slots on a busy address", () => {
  it("doesn't re-try every slot already taken (each try is a database write)", async () => {
    for (let i = 0; i < BOARD_SLOTS_PER_ADDRESS; i++) expect(await claimBoardSlot("100.64.9.9", "daily", "2026-11-12")).toBe(true);
    // One try per entry, not 1 + 2 + … + 25.
    expect(tried).toHaveLength(BOARD_SLOTS_PER_ADDRESS);
    tried.length = 0;
    // Full: refused straight away, however often it's asked.
    for (let i = 0; i < 10; i++) expect(await claimBoardSlot("100.64.9.9", "daily", "2026-11-12")).toBe(false);
    expect(tried).toHaveLength(0);
  });

  it("still finds a slot another instance took: it tries on from there", async () => {
    tried.length = 0;
    // Slots 0–2 taken elsewhere: this instance doesn't know, tries them, and remembers.
    for (let i = 0; i < 3; i++) taken.add(`board:daily:2026-11-13:${(await import("@/lib/server/crypto")).deriveSeed("board-ip", "100.64.9.10")}:${i}`);
    expect(await claimBoardSlot("100.64.9.10", "daily", "2026-11-13")).toBe(true);
    expect(tried).toHaveLength(4);
    expect(await claimBoardSlot("100.64.9.10", "daily", "2026-11-13")).toBe(true);
    expect(tried).toHaveLength(5);
  });
});
