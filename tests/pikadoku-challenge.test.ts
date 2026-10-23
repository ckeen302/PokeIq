import { describe, expect, it } from "vitest";
import { challengeLabel, decodeChallenge, encodeChallenge, judgeChallenge } from "@/lib/pikadoku/challenge";
import { DEFAULT_PDK_SETTINGS } from "@/lib/pikadoku/types";
import { practiceGrid } from "@/lib/server/pikadoku";

describe("challenge links", () => {
  const settings = { ...DEFAULT_PDK_SETTINGS, unlimitedPP: true, allowSingle: true, timer: false, families: ["types" as const, "evolution" as const] };

  it("round-trips the seed, the settings and the sharer's result", () => {
    const code = encodeChallenge({ seed: "k3j9a8xq", settings, result: { solved: 9, guesses: 12 } });
    expect(code).toBe("k3j9a8xq.1110.te.9.12");
    expect(decodeChallenge(code)).toEqual({ seed: "k3j9a8xq", settings: { ...settings, softLockGuard: true }, result: { solved: 9, guesses: 12 } });
  });
  it("works without a result (a link to the bare grid)", () => {
    const c = decodeChallenge(encodeChallenge({ seed: "abcd1234", settings: DEFAULT_PDK_SETTINGS, result: null }));
    expect(c?.result).toBeNull();
    expect(c?.settings.families).toHaveLength(6);
  });
  it("deals the exact same grid to the opener", () => {
    const a = practiceGrid("k3j9a8xq", settings);
    const opened = decodeChallenge(encodeChallenge({ seed: "k3j9a8xq", settings, result: { solved: 5, guesses: 9 } }))!;
    const b = practiceGrid(opened.seed, opened.settings);
    expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id));
    expect(b.cols.map((r) => r.id)).toEqual(a.cols.map((r) => r.id));
    expect(practiceGrid("zzzz9999", settings).rows.map((r) => r.id)).not.toEqual(a.rows.map((r) => r.id));
  });
  it("rejects anything that is not one of ours", () => {
    for (const bad of [null, 5, "", "abc.1111.t", "k3j9a8xq.11.te", "k3j9a8xq.1110.x", "K3J9A8XQ.1110.te", "k3j9a8xq.1110.te.10.2", "k3j9a8xq.1110.te.9", "k3j9a8xq.1110.te.9.12.1", "a".repeat(90)]) expect(decodeChallenge(bad)).toBeNull();
  });
  it("judges: more cells, then fewer guesses", () => {
    const theirs = { solved: 8, guesses: 12 };
    expect(judgeChallenge({ solved: 9, guesses: 20 }, theirs)).toBe("beat");
    expect(judgeChallenge({ solved: 8, guesses: 11 }, theirs)).toBe("beat");
    expect(judgeChallenge({ solved: 8, guesses: 12 }, theirs)).toBe("tied");
    expect(judgeChallenge({ solved: 8, guesses: 13 }, theirs)).toBe("lost");
    expect(judgeChallenge({ solved: 7, guesses: 7 }, theirs)).toBe("lost");
    expect(challengeLabel({ solved: 9, guesses: 1 })).toBe("9/9 in 1 guess");
  });
});
