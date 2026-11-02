import type { Difficulty, ModuleId, QuizFormat, QuizScope } from "@/engines/types";
import type { HeldStartResponse, NextResponse, StartResponse } from "@/lib/session-types";

/**
 * Getting a quiz ready before the Start click, so question 1 shows at once.
 *
 * QuizSetup asks the server to hold a run for the settings on screen (when
 * the page goes idle, when a setting changes, when Start is hovered or
 * focused). A held run has no clock and stores nothing; the browser gets
 * only question 1's pictures and cry, which it downloads now. The Start
 * click then begins that run (question 1 and its clock start on the
 * server), if it was held for exactly the settings being started, and not
 * too long ago. Anything else starts fresh, as without a prefetch.
 *
 * Only regular runs are held: never a daily (starting it counts it as
 * played) or a friend's challenge.
 */

export interface RegularStart {
  module: ModuleId;
  format: QuizFormat;
  difficulty: Difficulty;
  gens?: number[];
  scope?: QuizScope;
}

/** A held run is used within this long (the server keeps it beginnable for 10 minutes). */
export const PREFETCH_TTL_MS = 5 * 60 * 1000;
/** Held runs asked for per page view at most (each spends one of the start rate limit's tokens). */
export const PREFETCH_BUDGET = 4;

/** The settings a held run must match to be used, or null for a run that's never held. */
export function prefetchKey(req: object): string | null {
  if ("daily" in req || "zoomDaily" in req || "challenge" in req) return null;
  const r = req as RegularStart;
  if (!r.module || !r.format) return null;
  return JSON.stringify([r.module, r.format, r.difficulty, [...(r.gens ?? [])].sort((a, b) => a - b), r.scope ?? null]);
}

/** POSTs a JSON body to /api/session and resolves with the reply, or rejects on an error status. */
export type SessionPost = (body: object) => Promise<unknown>;

export interface QuizPrefetcherOptions {
  post: SessionPost;
  /** Downloads question 1's pictures and sound. */
  preload?: (assets: HeldStartResponse["assets"]) => void;
  now?: () => number;
  budget?: number;
  ttlMs?: number;
}

export interface QuizPrefetcher {
  /** Hold a run for these settings, unless one is already held for them (true: a request went out). */
  prefetch(req: object, name?: string): boolean;
  /**
   * The Start click: begin the run held for exactly these settings. Null when
   * there's none (start fresh); a promise of null when it couldn't be begun.
   */
  take(req: object): Promise<StartResponse | null> | null;
  /** How many runs this page view has asked to hold. */
  readonly used: number;
}

export function createQuizPrefetcher({ post, preload, now = Date.now, budget = PREFETCH_BUDGET, ttlMs = PREFETCH_TTL_MS }: QuizPrefetcherOptions): QuizPrefetcher {
  let ahead: { key: string; at: number; held: Promise<HeldStartResponse | null> } | null = null;
  let used = 0;
  return {
    prefetch(req, name) {
      const key = prefetchKey(req);
      if (!key) return false;
      if (ahead && ahead.key === key && now() - ahead.at < ttlMs) return false;
      if (used >= budget) return false;
      used++;
      const held = post({ ...req, ...(name && { name }), hold: true }).then(
        (r) => r as HeldStartResponse,
        () => null
      );
      if (preload) void held.then((h) => h && preload(h.assets));
      ahead = { key, at: now(), held };
      return true;
    },
    take(req) {
      const key = prefetchKey(req);
      const ready = ahead;
      ahead = null; // a held run begins once
      if (!key || !ready || ready.key !== key || now() - ready.at >= ttlMs) return null;
      return ready.held
        .then(async (h) => {
          if (!h) return null;
          const begun = (await post({ begin: h.token })) as NextResponse;
          return { token: begun.token, question: begun.question, rules: h.rules, lives: h.lives };
        })
        .catch(() => null);
    },
    get used() {
      return used;
    },
  };
}
