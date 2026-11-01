import { shinyImageUrl } from "@/lib/shiny";
import "server-only";
import { z } from "zod";
import { Rng } from "@/lib/rng";
import { buildQuestion } from "@/engines";
import {
  DIFFICULTIES,
  FORMATS,
  MODULES,
  SCOPES,
  type Question,
} from "@/engines/types";
import { revealFactor } from "@/lib/whose-team";
import { artUrl } from "@/lib/pokemon/art";
import { artworkUrl, getPokemon } from "@/lib/pokemon/pokedex";
import { itemInformation, performanceRating, ratingStandardError, ratingToIQ, type AnsweredItem } from "@/lib/rating";
import { deriveSeed, randomId, signToken, verifyToken } from "./crypto";
import { itemRating } from "./calibration";
import { mediaUrl } from "./media-url";
import { guessedSpecies, zoomStepWindow, zoomView } from "./zoom-reveal";
import { ZOOM_STEPS, zoomPoints } from "@/lib/zoom-reveal";
import type {
  AnswerResponse,
  NextResponse,
  PublicQuestion,
  RevealResponse,
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
 *                                   returns the solution and a new token
 *   3. POST /api/session/next    -> question #N+1; its clock starts now, so
 *                                   time spent reading a solution is free
 *                                   (Blitz skips this: #N+1 comes with step 2)
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
  practice: z.enum(["challenge", "repeat-daily", "filtered", "zoom-daily"]).optional(),
  zoomDaily: z.string().optional(),
  scope: z.enum(SCOPES).optional(),
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

/** The daily Zoom Reveal: one Pokémon, as long as you like. */
const ZOOM_DAILY_RULES: FormatRules = { total: 1, lives: null, questionMs: null, runMs: null };

/** A run's rules: its format's, except the one-Pokémon daily Zoom Reveal. */
export function rulesFor(spec: SessionSpec): FormatRules {
  return spec.zoomDaily ? ZOOM_DAILY_RULES : FORMAT_RULES[spec.format];
}

/** Network latency allowance on top of the visible timer. */
const GRACE_MS = 2_500;
/**
 * Asset-loading allowance. The client starts its visible countdown only once
 * the question's images / cry are loaded and decoded, and reports how long
 * that took (`loadMs`) with its answer. The server's clock still starts when
 * it serves the question; it simply credits the reported load time, clamped
 * to this cap and to the real elapsed time. A dishonest client can therefore
 * gain at most this much extra viewing time per question, while honest
 * players on slow connections are never charged for downloading images.
 */
export const MAX_LOAD_CREDIT_MS = 6_000;
const MAX_QUESTIONS = 250;
/** Per-instance caches: enough for hundreds of concurrent runs, bounded in memory. */
const MAX_STREAMS = 200;
const MAX_ADAPTIVE_STEPS = 3000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const STREAK_BONUS = 10;

/** Compact answer log entry: [correct 0|1, elapsedMs, itemRating, optionCount]. */
type LogEntry = [0 | 1, number, number, number];

export interface SessionState {
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
  /** Timed formats: the next question hasn't been served yet (see nextQuestion). */
  paused?: true;
  /** Blitz: total asset-loading time credited to the run clock so far. */
  lc?: number;
  /** Revealed questions (Whose Team on Hard): cards served beyond the first ones, for the current question. */
  rv?: number;
  /** Zoom Reveal: steps already zoomed out on the current question (wrong names and skips). */
  zs?: number;
  /** Zoom Reveal: the step each Pokémon so far was named on, "X" when missed. */
  zr?: string;
}

/** Load-time credit for one question: client-reported, clamped server-side. */
export function loadCredit(loadMs: number | undefined, elapsed: number): number {
  if (!loadMs || !Number.isFinite(loadMs) || loadMs <= 0) return 0;
  return Math.min(loadMs, MAX_LOAD_CREDIT_MS, Math.max(0, elapsed));
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
  // The scope is appended only when set, so every other run keeps its key (and its questions).
  return [spec.seed, spec.module, spec.difficulty, (spec.gens ?? []).join(","), ...(spec.scope ? [spec.scope] : [])].join("|");
}

/**
 * Question `index` of a session. Fixed-format runs are a pure function of
 * the seed; adaptive runs also depend on the answers so far (`log`).
 */
export function questionAt(spec: SessionSpec, index: number, log: readonly LogEntry[] = []): Question {
  if (spec.format === "adaptive") return adaptiveQuestionAt(spec, index, log);
  const key = streamKey(spec);
  let stream = streams.get(key);
  if (!stream) {
    stream = { rng: new Rng(deriveSeed("quiz", key)), used: new Set(), questions: [] };
  }
  while (stream.questions.length <= index) {
    stream.questions.push(
      buildQuestion(spec.module, stream.rng, {
        difficulty: spec.difficulty,
        gens: spec.gens,
        used: stream.used,
        scope: spec.scope,
      })
    );
  }
  streams.delete(key); // LRU refresh
  streams.set(key, stream);
  if (streams.size > MAX_STREAMS) streams.delete(streams.keys().next().value!);
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
        const q = buildQuestion(spec.module, rng, { difficulty, gens: spec.gens, used: scratch, scope: spec.scope });
        const ids = [...scratch].filter((id) => !used.has(id));
        candidates.push({ q, ids, info: itemInformation(theta, q.rating, q.options.length) });
      }
    }
    candidates.sort((a, b) => b.info - a.info);
    const pick = candidates[Math.floor(rng.next() * Math.min(3, candidates.length))];
    pick.ids.forEach((id) => used.add(id));
    chosen = pick.q;
    adaptiveCache.set(cacheKey, { used: [...used], q: chosen });
    if (adaptiveCache.size > MAX_ADAPTIVE_STEPS) adaptiveCache.delete(adaptiveCache.keys().next().value!);
  }
  return chosen!;
}

// ---------------------------------------------------------------------------
// Public projections (what the browser is allowed to see)
// ---------------------------------------------------------------------------

export { mediaUrl };

/** How many of a revealed question's cards the player has seen. */
export const shownCards = (q: Question, extra = 0) => (q.reveal ? Math.min(q.reveal + extra, q.cards?.length ?? 0) : (q.cards?.length ?? 0));

const publicCard = (c: { pokemonId: number; label: string }) => ({ label: c.label, imageUrl: artworkUrl(c.pokemonId) });
/** Team cards (Whose Team): the Pokédex's small WebP artwork, six at a time. */
const teamCard = (c: { pokemonId: number; label: string }) => ({ label: c.label, imageUrl: artUrl(c.pokemonId, 160) });
const cardOf = (q: Question) => (q.input === "type" ? teamCard : publicCard);

/**
 * What the browser may see of a question. Zoom Reveal: only the crop for
 * `step`. A revealed question (Whose Team on Hard): only the cards shown so
 * far (`extra` beyond the first ones); the rest stay on the server.
 */
export function toPublic(q: Question, index: number, rules: FormatRules, step = 1, extra = 0): PublicQuestion {
  // Zoom Reveal: no options and no plain media, just the current step's crop.
  if (q.input === "name" && q.media) {
    return { index, module: q.module, prompt: q.prompt, options: [], input: "name", zoom: zoomView(q.media, step), timeLimitMs: rules.questionMs };
  }
  const cards = q.reveal ? q.cards?.slice(0, shownCards(q, extra)) : q.cards;
  return {
    index,
    module: q.module,
    prompt: q.prompt,
    detail: q.detail,
    options: q.options,
    images: q.optionImages ? q.options.map(shinyImageUrl) : undefined,
    media: q.media
      ? { type: q.media.kind === "cry" ? "audio" : "image", url: mediaUrl(q.media), zoom: q.media.kind === "silhouette-zoom" }
      : undefined,
    cards: cards?.map(cardOf(q)),
    timeLimitMs: rules.questionMs,
    ...(q.input && { input: q.input }),
    ...(q.reveal && { reveal: { shown: shownCards(q, extra), total: q.cards?.length ?? 0 } }),
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

export function learnHref(q: Question): string | undefined {
  const id = q.revealMedia?.pokemonId ?? q.media?.pokemonId;
  const slug = id ? getPokemon(id)?.slug : undefined;
  return slug ? `/pokemon/${slug}` : undefined;
}

function isDone(state: SessionState, rules: FormatRules, now: number): boolean {
  if (rules.total !== null && state.log.length >= rules.total) return true;
  if (state.lives !== null && state.lives <= 0) return true;
  if (rules.runMs !== null && now - state.startedAt - (state.lc ?? 0) > rules.runMs) return true;
  return state.log.length >= MAX_QUESTIONS;
}

/** A typed guess names the answer: any accepted spelling of the species, or one of its forms. */
function rightName(q: Question, choice: string): boolean {
  const id = q.revealMedia?.pokemonId ?? q.media?.pokemonId;
  return choice === q.answer || (id !== undefined && guessedSpecies(choice) === id);
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
    durationMs: Math.max(1, now - state.startedAt - (state.lc ?? 0)),
    rating,
    pokeiq: ratingToIQ(rating),
    finishedAt: now,
    ...(state.spec.practice && { practice: state.spec.practice }),
    ...(state.zr && { zoom: state.zr }),
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
  const rules = rulesFor(spec);
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
  | {
      ok: true;
      response: AnswerResponse;
      claimKey: string;
      itemKey: string;
      correct: boolean;
      rating: number;
      /** False when nothing was logged (expired Blitz clock): skip calibration. */
      record: boolean;
      /** Server-side estimate of the player's rating before this answer, for calibration. */
      playerRating: number;
      /**
       * Revealed questions: claim this before grading. It is the next card's
       * reveal claim, so it fails when that card was already revealed with a
       * newer token (an older token can't be used to answer for more points).
       */
      revealGuard?: string;
    }
  | { ok: false; status: number; error: string };

/** Replay-guard key for grading the session's current question. */
export function answerClaimKey(state: SessionState): string {
  // Zoom Reveal grades each step of a question once.
  return `ans:${state.sid}:${state.log.length}${state.zs ? `.${state.zs}` : ""}`;
}

export function readSession(token: unknown): SessionState | null {
  const state = verifyToken<SessionState>("session", token);
  if (!state || state.v !== 1) return null;
  if (Date.now() - state.startedAt > SESSION_TTL_MS) return null;
  return specSchema.safeParse(state.spec).success ? state : null;
}

/** Pure grading step; the route handler performs the replay claim. */
export function gradeAnswer(state: SessionState, choice: string | null, loadMs?: number): AnswerOutcome {
  const rules = rulesFor(state.spec);
  const now = Date.now();
  const credit = state.paused ? 0 : loadCredit(loadMs, now - state.servedAt);
  const runCredit = rules.runMs !== null ? (state.lc ?? 0) + credit : 0;
  // Blitz: answers within the latency grace still count; the client's
  // "time's up" ping (choice === null) — or any request after the clock ran
  // out, e.g. from a backgrounded tab — closes the run with its result.
  const runElapsed = now - state.startedAt - runCredit;
  const runExpired =
    rules.runMs !== null &&
    (runElapsed > rules.runMs + GRACE_MS || (choice === null && runElapsed >= rules.runMs - 500));
  // The run clock is handled by runExpired, so only count / lives end it here.
  if (isDone(state, { ...rules, runMs: null }, now)) {
    return { ok: false, status: 409, error: "This run is already over." };
  }
  if (state.paused && !runExpired) {
    return { ok: false, status: 409, error: "That question hasn't started yet." };
  }

  const index = state.log.length;
  const q = questionAt(state.spec, index, state.log);
  const elapsed = now - state.servedAt - credit;
  const timedOut = rules.questionMs !== null && elapsed > rules.questionMs + GRACE_MS;
  const zoom = q.input === "name";
  const step = (state.zs ?? 0) + 1;
  const correct = !timedOut && !runExpired && choice !== null && (zoom ? rightName(q, choice) : choice === q.answer);
  const rating = itemRating(q.itemKey, q.rating);

  // Zoom Reveal: a wrong name, a skip or the step's clock running out zooms
  // out one step. The question goes on and nothing about the answer leaves.
  if (zoom && !correct && !runExpired && step < ZOOM_STEPS) {
    const stepped: SessionState = { ...state, paused: undefined, servedAt: now, zs: step, ...(runCredit > 0 && { lc: runCredit }) };
    return {
      ok: true,
      response: {
        correct: false,
        timedOut,
        answer: "",
        tags: [],
        gained: 0,
        score: state.score,
        streak: state.streak,
        lives: state.lives,
        answered: state.log.length,
        token: signToken("session", stepped),
        done: false,
        counted: false,
        awaitNext: false,
        zoom: zoomView(q.media!, step + 1),
      },
      claimKey: answerClaimKey(state),
      itemKey: q.itemKey,
      correct: false,
      rating,
      record: false,
      playerRating: performanceRating(toItems(state.log)),
    };
  }

  const shown = shownCards(q, state.rv ?? 0);
  const total = q.cards?.length ?? 0;
  let gained = 0;
  if (zoom && correct) {
    gained = zoomPoints(step) + STREAK_BONUS * state.streak;
  } else if (correct) {
    const speed = rules.questionMs
      ? Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsed / rules.questionMs))
      : 0;
    // Revealed questions: fewer Pokémon seen, more points (see revealFactor).
    const factor = q.reveal ? revealFactor(shown, total) : 1;
    gained = Math.round((BASE_POINTS + speed) * factor) + STREAK_BONUS * state.streak;
  }

  const next: SessionState = {
    ...state,
    paused: undefined,
    rv: undefined,
    servedAt: now,
    log: runExpired ? state.log : [...state.log, [correct ? 1 : 0, elapsed, rating, q.options.length]],
    score: state.score + gained,
    streak: correct ? state.streak + 1 : 0,
    best: Math.max(state.best, correct ? state.streak + 1 : 0),
    lives: state.lives !== null && !correct ? state.lives - 1 : state.lives,
    ...(runCredit > 0 && { lc: runCredit }),
    zs: undefined,
    ...(zoom && !runExpired && { zr: `${state.zr ?? ""}${correct ? step : "X"}` }),
  };

  const done = runExpired || isDone(next, rules, now);
  // Timed formats hold the next question until the player asks for it.
  const awaitNext = !done && rules.questionMs !== null;
  if (awaitNext) next.paused = true;
  const response: AnswerResponse = {
    correct,
    timedOut,
    answer: q.answer,
    explanation: q.explanation,
    revealUrl: q.revealMedia ? mediaUrl(q.revealMedia) : undefined,
    learnHref: learnHref(q),
    sourceUrl: q.source,
    ...(q.reveal && { revealCards: q.cards?.map(cardOf(q)) }),
    tags: runExpired ? [] : skillTags(q),
    gained,
    score: next.score,
    streak: next.streak,
    lives: next.lives,
    answered: next.log.length,
    token: signToken("session", next),
    done,
    counted: !runExpired,
    awaitNext,
    ...(zoom && { step, zoomFrom: zoomStepWindow(q.media!.pokemonId, q.media!.crop ?? 0, step) }),
  };

  if (done) {
    const result = buildResult(next, now);
    response.result = result;
    response.resultToken = signToken("result", result);
    response.shareToken = signToken("share", toShareCard(result, next.name));
  } else if (!awaitNext) {
    response.next = toPublic(questionAt(next.spec, next.log.length, next.log), next.log.length, rules);
  }

  return {
    ok: true,
    response,
    claimKey: answerClaimKey(state),
    itemKey: q.itemKey,
    correct,
    rating,
    record: !runExpired,
    playerRating: performanceRating(toItems(state.log)),
    ...(q.reveal && shown < total && { revealGuard: revealClaimKey(state, shown + 1) }),
  };
}

/** Replay-guard key for revealing card `n` (1-based) of the session's current question. */
export const revealClaimKey = (state: SessionState, n: number) => `rev:${state.sid}:${state.log.length}:${n}`;

export type RevealOutcome =
  | { ok: true; response: RevealResponse; claimKey: string }
  | { ok: false; status: number; error: string };

/**
 * One more card of the current revealed question (Whose Team on Hard). Each
 * card can be revealed once per session (the route claims `claimKey`), and
 * the new token counts it, so the answer is scored on what was seen.
 */
export function revealCard(state: SessionState): RevealOutcome {
  const rules = rulesFor(state.spec);
  const now = Date.now();
  if (isDone(state, rules, now)) return { ok: false, status: 409, error: "This run is already over." };
  if (state.paused) return { ok: false, status: 409, error: "That question hasn't started yet." };
  const index = state.log.length;
  const q = questionAt(state.spec, index, state.log);
  if (!q.reveal || !q.cards) return { ok: false, status: 400, error: "This question has nothing to reveal." };
  const extra = state.rv ?? 0;
  const shown = shownCards(q, extra);
  if (shown >= q.cards.length) return { ok: false, status: 409, error: "The whole team is already showing." };
  if (rules.questionMs !== null && now - state.servedAt > rules.questionMs + MAX_LOAD_CREDIT_MS + GRACE_MS) {
    return { ok: false, status: 409, error: "Time's up for that question." };
  }
  const next: SessionState = { ...state, rv: extra + 1 };
  return {
    ok: true,
    response: {
      token: signToken("session", next),
      card: cardOf(q)(q.cards[shown]),
      reveal: { shown: shown + 1, total: q.cards.length },
    },
    claimKey: revealClaimKey(state, shown + 1),
  };
}

export type NextOutcome =
  | { ok: true; response: NextResponse; claimKey: string }
  | { ok: false; status: number; error: string };

/**
 * Serve the paused next question of a timed run and start its clock. Each
 * question can be served once (the route claims `claimKey`), so the timer
 * can't be restarted by replaying the paused token.
 */
export function nextQuestion(state: SessionState): NextOutcome {
  const rules = rulesFor(state.spec);
  if (!state.paused) return { ok: false, status: 409, error: "That question is already in play." };
  const now = Date.now();
  if (isDone(state, rules, now)) return { ok: false, status: 409, error: "This run is already over." };
  const index = state.log.length;
  const question = toPublic(questionAt(state.spec, index, state.log), index, rules);
  const resumed: SessionState = { ...state, paused: undefined, rv: undefined, servedAt: now };
  return {
    ok: true,
    response: { token: signToken("session", resumed), question },
    claimKey: `next:${state.sid}:${index}`,
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
    ...(result.spec.scope && { o: result.spec.scope }),
    day: result.spec.daily,
    sc: result.score,
    c: result.correct,
    t: result.total,
    q: result.pokeiq,
    gr: result.grid,
  };
}
