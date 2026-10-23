import { DEFAULT_PDK_SETTINGS, PDK_FAMILIES, type PdkFamily, type PdkSettings } from "./types";

/**
 * Challenge links for Unlimited grids: "Share this grid" makes a link with the
 * grid's seed and settings plus the sharer's result. Whoever opens it plays the
 * exact same grid (the seed and settings deal it) and sees what to beat.
 *
 *   /pikadoku?c=<seed>.<flags>.<families>.<solved>.<guesses>
 *
 * flags: four 0/1 for unlimited PP, soft-lock guard, single-answer cells, timer.
 * families: one letter each (t r e m a o). The result is cells filled and the
 * guesses it took; there are no names and nothing about the answers.
 */
export interface PdkChallenge {
  seed: string;
  settings: PdkSettings;
  /** Cells the sharer filled (0-9), and the guesses (right and wrong) it took; null for a link to the bare grid. */
  result: { solved: number; guesses: number } | null;
}

const FAMILY_LETTER: Record<PdkFamily, string> = { types: "t", regions: "r", evolution: "e", moves: "m", abilities: "a", other: "o" };
const CHALLENGE_RE = /^([a-z0-9]{4,24})\.([01]{4})\.([tremao]{1,6})(?:\.([0-9])\.(\d{1,3}))?$/;

/** The link's `c` value. */
export function encodeChallenge(c: PdkChallenge): string {
  const s = c.settings;
  const flags = [s.unlimitedPP, s.softLockGuard, s.allowSingle, s.timer].map((b) => (b ? "1" : "0")).join("");
  const fams = PDK_FAMILIES.filter((f) => s.families.includes(f))
    .map((f) => FAMILY_LETTER[f])
    .join("");
  const base = `${c.seed}.${flags}.${fams || "tremao"}`;
  return c.result ? `${base}.${Math.min(9, Math.max(0, Math.round(c.result.solved)))}.${Math.min(999, Math.max(0, Math.round(c.result.guesses)))}` : base;
}

/** Reads a `c` value back, or null for anything that isn't one of ours. */
export function decodeChallenge(raw: unknown): PdkChallenge | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const m = CHALLENGE_RE.exec(raw);
  if (!m) return null;
  const [, seed, flags, fams, solved, guesses] = m;
  const families = PDK_FAMILIES.filter((f) => fams.includes(FAMILY_LETTER[f]));
  if (!families.length) return null;
  return {
    seed,
    settings: {
      ...DEFAULT_PDK_SETTINGS,
      unlimitedPP: flags[0] === "1",
      softLockGuard: flags[1] === "1",
      allowSingle: flags[2] === "1",
      timer: flags[3] === "1",
      families,
    },
    result: solved !== undefined ? { solved: Number(solved), guesses: Number(guesses) } : null,
  };
}

export type ChallengeVerdict = "beat" | "tied" | "lost";

/** More cells wins; the same cells in fewer guesses wins; the same is a tie. */
export function judgeChallenge(mine: { solved: number; guesses: number }, theirs: { solved: number; guesses: number }): ChallengeVerdict {
  if (mine.solved !== theirs.solved) return mine.solved > theirs.solved ? "beat" : "lost";
  if (mine.guesses !== theirs.guesses) return mine.guesses < theirs.guesses ? "beat" : "lost";
  return "tied";
}

/** "9/9 in 12 guesses". */
export const challengeLabel = (r: { solved: number; guesses: number }) => `${r.solved}/9 in ${r.guesses} guess${r.guesses === 1 ? "" : "es"}`;
