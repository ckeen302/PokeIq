import "server-only";
import { z } from "zod";
import { Rng } from "@/lib/rng";
import { buildQuestion } from "@/engines";
import {
  DIFFICULTIES,
  FORMATS,
  MODULES,
  type MediaRef,
  type Question,
} from "@/engines/types";
import { artworkUrl, getPokemon } from "@/lib/pokemon/pokedex";
import { itemInformation, performanceRating, ratingStandardError, ratingToIQ, type AnsweredItem } from "@/lib/rating";
import { deriveSeed, encryptJson, randomId, signToken, verifyToken } from "./crypto";
import { itemRating } from "./calibration";
import type {
  AnswerResponse,
  PublicQuestion,
  RunResult,
  SessionSpec,
  ShareCard,
} from "@/lib/session-types";

/**
 * Server-authoritative quiz sessions.
 *
 * The client never holds an answer it hasn't already committed to:
 *   1. POST /api/session         -> question #0 (no answer) + signed state token
 *   2. POST /api/session/answer  -> grades against the server-derived question,
 *                                   returns the solution, question #N+1 and a
 *                                   new token
 * Questions are re-derived from HMAC(secret, seed) on every request instead of
 * being stored, timing is measured with server clocks, and each (session,
 * index) can be graded only once (see replay-guard.ts).
 */

export const specSchema = z.object({
  module: z.enum(MODULES),
  format: z.enum(FORMATS),
  difficulty: z.enum(DIFFICULTIES),
  gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
  seed: z.string().min(4).max(64),
  daily: z.string().optional(),
});

export interface FormatRules {
  /** Fixed question count, or null for endless. */
  total: number | null;
  lives: number | null;
  /** Per-question limit. */
  questionMs: number | null;
  /** Whole-run limit (Blitz). */
  runMs: number | null;
}

export const FORMAT_RULES: Record<SessionSpec["format"], FormatRules> = {
  classic: { total: 10, lives: null, questionMs: 15_000, runMs: null },
  survival: { total: null, lives: 3, questionMs: 15_000, runMs: null },
  blitz: { total: null, lives: null, questionMs: null, runMs: 60_000 },
  adaptive: { total: 20, lives: null, questionMs: 20_000, runMs: null },
};

/** Network latency allowance on top of the visible timer. */
const GRACE_MS = 2_500;
const MAX_QUESTIONS = 250;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MEDIA_TTL_MS = 30 * 60 * 1000;

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const STREAK_BONUS = 10;

/** Compact answer log entry: [correct 0|1, elapsedMs, itemRating, optionCount]. */
type LogEntry = [0 | 1, number, number, number];

interface SessionState {
  v: 1;
  sid: string;
  spec: SessionSpec;
  name?: string;
  startedAt: number;
  servedAt: number;
  log: LogEntry[];
  score: number;
  streak: number;
  best: number;
  lives: number | null;
}

// ---------------------------------------------------------------------------
// Deterministic question stream (with a small per-instance continuation cache)
// ---------------------------------------------------------------------------

interface Stream {
  rng: Rng;
  used: Set<number>;
  questions: Question[];
}

const streams = new Map<string, Stream>();

function streamKey(spec: SessionSpec): string {
  return [spec.seed, spec.module, spec.difficulty, (spec.gens ?? []).join(",")].join("|");
}

/**
 * Question `index` of a session. Fixed-format runs are a pure function of
 * the seed; adaptive runs also depend on the answers so far (`log`).
 */
export function questionAt(spec: SessionSpec, index: number, log: readonly LogEntry[] = []): Question {
  if (spec.format === "adaptive") return adaptiveQuestionAt(spec, index, log);
  const key = streamKey(spec);
  let stream = streams.get(key);
  if (!stream || stream.questions.length > index + 400) {
    stream = { rng: new Rng(deriveSeed("quiz", key)), used: new Set(), questions: [] };
  }
  while (stream.questions.length <= index) {
    stream.questions.push(
      buildQuestion(spec.module, stream.rng, {
        difficulty: spec.difficulty,
        gens: spec.gens,
        used: stream.used,
      })
    );
  }
  streams.delete(key); // LRU refresh
  streams.set(key, stream);
  if (streams.size > 500) streams.delete(streams.keys().next().value!);
  return stream.questions[index];
}

// ---------------------------------------------------------------------------
// Adaptive selection (computerized adaptive testing)
// ---------------------------------------------------------------------------

const ADAPTIVE_CANDIDATES: Record<SessionSpec["difficulty"], number> = { easy: 4, medium: 4, hard: 4 };

const toItems = (log: readonly LogEntry[]): AnsweredItem[] =>
  log.map(([c, , r, k]) => ({ correct: c === 1, rating: r, options: k }));

/**
 * Before each question, estimate the player's rating from the answers so
 * far (Bayesian MAP), generate a small bank of candidates across all
 * difficulties, and serve the one with the most Fisher information at that
 * estimate (randomised among the top 3 to avoid always serving the same
 * kind of question). Replaying the answer log reproduces every choice, so
 * this stays stateless and deterministic.
 *
 * Selection uses each question's *prior* rating, never the live calibration
 * snapshot, so a refresh mid-session can't change which question is graded.
 */
const adaptiveCache = new Map<string, { used: number[]; q: Question }>();

function adaptiveQuestionAt(spec: SessionSpec, index: number, log: readonly LogEntry[]): Question {
  const key = streamKey(spec);
  let used = new Set<number>();
  let chosen: Question | null = null;
  let signature = "";

  for (let i = 0; i <= index; i++) {
    // Position i depends only on the seed and answers 0..i-1: memoise on that
    // prefix so a request computes one new step instead of replaying all.
    if (i > 0) signature += `,${log[i - 1][0]}${log[i - 1][2]}.${log[i - 1][3]}`;
    const cacheKey = `${key}|${i}|${signature}`;
    const cached = adaptiveCache.get(cacheKey);
    if (cached) {
      used = new Set(cached.used);
      chosen = cached.q;
      continue;
    }

    const theta = performanceRating(toItems(log.slice(0, i)));
    const rng = new Rng(deriveSeed("quiz-adaptive", `${key}:${i}`));
    const candidates: { q: Question; ids: number[]; info: number }[] = [];
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let c = 0; c < ADAPTIVE_CANDIDATES[difficulty]; c++) {
        const scratch = new Set(used);
        const q = buildQuestion(spec.module, rng, { difficulty, gens: spec.gens, used: scratch });
        const ids = [...scratch].filter((id) => !used.has(id));
        candidates.push({ q, ids, info: itemInformation(theta, q.rating, q.options.length) });
      }
    }
    candidates.sort((a, b) => b.info - a.info);
    const pick = candidates[Math.floor(rng.next() * Math.min(3, candidates.length))];
    pick.ids.forEach((id) => used.add(id));
    chosen = pick.q;
    adaptiveCache.set(cacheKey, { used: [...used], q: chosen });
    if (adaptiveCache.size > 5000) adaptiveCache.delete(adaptiveCache.keys().next().value!);
  }
  return chosen!;
}

// ---------------------------------------------------------------------------
// Public projections (what the browser is allowed to see)
// ---------------------------------------------------------------------------

export function mediaUrl(ref: MediaRef): string {
  return `/api/media/${encryptJson({ k: ref.kind, id: ref.pokemonId, x: Date.now() + MEDIA_TTL_MS })}`;
}

function toPublic(q: Question, index: number, rules: FormatRules): PublicQuestion {
  return {
    index,
    module: q.module,
    prompt: q.prompt,
    detail: q.detail,
    options: q.options,
    media: q.media
      ? { type: q.media.kind === "cry" ? "audio" : "image", url: mediaUrl(q.media), zoom: q.media.kind === "silhouette-zoom" }
      : undefined,
    cards: q.cards?.map((c) => ({ label: c.label, imageUrl: artworkUrl(c.pokemonId) })),
    timeLimitMs: rules.questionMs,
  };
}

/** Skill tags the client-side coach aggregates into strengths / focus areas. */
function skillTags(q: Question): string[] {
  const tags = [`mod:${q.module}`];
  const id = q.revealMedia?.pokemonId ?? q.media?.pokemonId;
  const p = id ? getPokemon(id) : undefined;
  if (p) {
    tags.push(`gen:${p.gen}`);
    // Type Master questions are about the defender's typing.
    p.types.forEach((t) => tags.push(`type:${t}`));
  }
  const stat = q.module === "higher-lower" ? q.itemKey.split(":")[1] : null;
  if (stat) tags.push(`stat:${stat}`);
  return tags;
}

function learnHref(q: Question): string | undefined {
  const id = q.revealMedia?.pokemonId ?? q.media?.pokemonId;
  const slug = id ? getPokemon(id)?.slug : undefined;
  return slug ? `/pokemon/${slug}` : undefined;
}

function isDone(state: SessionState, rules: FormatRules, now: number): boolean {
  if (rules.total !== null && state.log.length >= rules.total) return true;
  if (state.lives !== null && state.lives <= 0) return true;
  if (rules.runMs !== null && now - state.startedAt > rules.runMs) return true;
  return state.log.length >= MAX_QUESTIONS;
}

function buildResult(state: SessionState, now: number): RunResult {
  const correct = state.log.filter((e) => e[0] === 1).length;
  const items = toItems(state.log);
  const rating = performanceRating(items);
  const adaptive = state.spec.format === "adaptive";
  return {
    sid: state.sid,
    spec: state.spec,
    score: state.score,
    correct,
    total: state.log.length,
    bestStreak: state.best,
    grid: state.log.map((e) => e[0]).join(""),
    durationMs: Math.max(1, now - state.startedAt),
    rating,
    pokeiq: ratingToIQ(rating),
    finishedAt: now,
    ...(adaptive && {
      se: ratingStandardError(rating, items),
      trajectory: items.map((_, i) => {
        const prefix = items.slice(0, i + 1);
        const r = performanceRating(prefix);
        return [r, ratingStandardError(r, prefix)] as [number, number];
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export function startSession(spec: SessionSpec, name?: string) {
  const rules = FORMAT_RULES[spec.format];
  const now = Date.now();
  const state: SessionState = {
    v: 1,
    sid: randomId(),
    spec,
    name: name?.slice(0, 24),
    startedAt: now,
    servedAt: now,
    log: [],
    score: 0,
    streak: 0,
    best: 0,
    lives: rules.lives,
  };
  return {
    token: signToken("session", state),
    sid: state.sid,
    question: toPublic(questionAt(spec, 0), 0, rules),
    rules,
    lives: state.lives,
  };
}

export type AnswerOutcome =
  | { ok: true; response: AnswerResponse; claimKey: string; itemKey: string; correct: boolean; rating: number }
  | { ok: false; status: number; error: string };

export function readSession(token: unknown): SessionState | null {
  const state = verifyToken<SessionState>("session", token);
  if (!state || state.v !== 1) return null;
  if (Date.now() - state.startedAt > SESSION_TTL_MS) return null;
  return specSchema.safeParse(state.spec).success ? state : null;
}

/** Pure grading step; the route handler performs the replay claim. */
export function gradeAnswer(state: SessionState, choice: string | null): AnswerOutcome {
  const rules = FORMAT_RULES[state.spec.format];
  const now = Date.now();
  if (isDone(state, rules, now - GRACE_MS)) {
    return { ok: false, status: 409, error: "This run is already over." };
  }

  const index = state.log.length;
  const q = questionAt(state.spec, index, state.log);
  const elapsed = now - state.servedAt;
  // Blitz: answers within the latency grace still count; the client's
  // "time's up" ping (choice === null) just closes the run without a penalty.
  const runElapsed = now - state.startedAt;
  const runExpired =
    rules.runMs !== null &&
    (runElapsed > rules.runMs + GRACE_MS || (choice === null && runElapsed >= rules.runMs - 500));
  const timedOut = rules.questionMs !== null && elapsed > rules.questionMs + GRACE_MS;
  const correct = !timedOut && !runExpired && choice !== null && choice === q.answer;
  const rating = itemRating(q.itemKey, q.rating);

  let gained = 0;
  if (correct) {
    const speed = rules.questionMs
      ? Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsed / rules.questionMs))
      : 0;
    gained = BASE_POINTS + speed + STREAK_BONUS * state.streak;
  }

  const next: SessionState = {
    ...state,
    servedAt: now,
    log: runExpired ? state.log : [...state.log, [correct ? 1 : 0, elapsed, rating, q.options.length]],
    score: state.score + gained,
    streak: correct ? state.streak + 1 : 0,
    best: Math.max(state.best, correct ? state.streak + 1 : 0),
    lives: state.lives !== null && !correct ? state.lives - 1 : state.lives,
  };

  const done = runExpired || isDone(next, rules, now);
  const response: AnswerResponse = {
    correct,
    timedOut,
    answer: q.answer,
    explanation: q.explanation,
    revealUrl: q.revealMedia ? mediaUrl(q.revealMedia) : undefined,
    learnHref: learnHref(q),
    tags: skillTags(q),
    gained,
    score: next.score,
    streak: next.streak,
    lives: next.lives,
    answered: next.log.length,
    token: signToken("session", next),
    done,
  };

  if (done) {
    const result = buildResult(next, now);
    response.result = result;
    response.resultToken = signToken("result", result);
    response.shareToken = signToken("share", toShareCard(result, next.name));
  } else {
    response.next = toPublic(questionAt(next.spec, next.log.length, next.log), next.log.length, rules);
  }

  return {
    ok: true,
    response,
    claimKey: `ans:${state.sid}:${index}`,
    itemKey: q.itemKey,
    correct,
    rating,
  };
}

export function toShareCard(result: RunResult, name?: string): ShareCard {
  return {
    n: name,
    m: result.spec.module,
    f: result.spec.format,
    d: result.spec.difficulty,
    g: result.spec.gens,
    s: result.spec.seed,
    day: result.spec.daily,
    sc: result.score,
    c: result.correct,
    t: result.total,
    q: result.pokeiq,
    gr: result.grid,
  };
}
