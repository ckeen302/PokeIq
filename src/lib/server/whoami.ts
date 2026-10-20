import "server-only";
import curated from "@/data/pokedle-pool.json";
import moves from "@/data/whoami-moves.json";
import { getPokemon, poolFor, type Pokemon } from "@/lib/pokemon/pokedex";
import { hashString, Rng } from "@/lib/rng";
import {
  COLOR_FAMILIES,
  MAX_GEN_WHOAMI,
  WHOAMI_LOCK_MS,
  WHOAMI_PP,
  WHOAMI_ROUND_MS,
  parseQuestion,
  questionCost,
  whoamiScore,
  type WhoamiClueKind,
  type WhoamiKnown,
  type WhoamiMine,
  type WhoamiPoolSettings,
  type WhoamiQuestion,
  type WhoamiSoloView,
} from "@/lib/whoami";
import { decryptJson, deriveSeed, encryptJson, randomId } from "./crypto";

/**
 * Who Am I?: the answers, the pools and one trainer's play (PP, what they
 * know, wrong guesses and lockouts), shared by practice, the daily and
 * duels. Everything is answered from the Pokédex data; the secret stays here.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const LEARNERS: Record<string, Set<number>> = Object.fromEntries(Object.entries(moves as Record<string, number[]>).map(([m, ids]) => [m, new Set(ids)]));

/** The true answer to `q` for Pokémon `p`. */
export function answer(q: WhoamiQuestion, p: Pokemon): boolean {
  switch (q.kind) {
    case "type":
      return p.types.includes(q.type as Pokemon["types"][number]);
    case "from":
      return p.gen >= q.gen;
    case "gen":
      return p.gen === q.gen;
    case "dual":
      return p.types.length > 1;
    case "final":
      return p.fullyEvolved;
    case "legend":
      return p.legendary || p.mythical;
    case "basic":
      return p.evolvesFrom === null;
    case "color":
      return COLOR_FAMILIES[q.family].colors.includes(p.color);
    case "height":
      return p.height > q.dm;
    case "weight":
      return p.weight > q.kg * 10;
    case "stat":
      return p.stats[q.stat] > q.over;
    case "bst":
      return p.bst > q.over;
    case "ability":
      return p.abilities.some((a) => a.name === q.ability);
    case "move":
      return LEARNERS[q.move]?.has(p.id) ?? false;
  }
}

/** Whether `p` fits everything known. */
export const fits = (known: readonly { q: string; yes: boolean }[], p: Pokemon) => known.every((k) => answer(parseQuestion(k.q)!, p) === k.yes);

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/**
 * The curated set: Pokédle's easier daily tier (src/data/pokedle-pool.json, 350 Pokémon),
 * the Pokémon most players recognise from their sprite. No Paradox
 * Pokémon, Ultra Beasts or other deep cuts.
 */
const CURATED: ReadonlySet<number> = new Set(curated.tiers[0]);

export function normalizeSettings(s: Partial<WhoamiPoolSettings> | undefined): WhoamiPoolSettings {
  const clamp = (n: unknown, d: number) => (Number.isInteger(n) ? Math.min(MAX_GEN_WHOAMI, Math.max(1, n as number)) : d);
  const a = clamp(s?.from, 1);
  const b = clamp(s?.to, MAX_GEN_WHOAMI);
  return { from: Math.min(a, b), to: Math.max(a, b), casual: !!s?.casual };
}

/** The Pokémon a game with these settings can be, in Pokédex order. */
export function poolOf(s: WhoamiPoolSettings): Pokemon[] {
  return poolFor().filter((p) => CURATED.has(p.id) && p.gen >= s.from && p.gen <= s.to && !(s.casual && (p.legendary || p.mythical)));
}

/** Pools too small to be a game are refused in the lobby. */
export const MIN_POOL = 12;

// ---------------------------------------------------------------------------
// One trainer's play
// ---------------------------------------------------------------------------

export interface WhoamiSeat {
  pp: number;
  known: WhoamiKnown[];
  wrong: number[];
  lockUntil: number;
  /** Taunted: no questions until then. */
  tauntUntil: number;
  solvedAt?: number;
}

export const newSeatPlay = (): WhoamiSeat => ({ pp: WHOAMI_PP, known: [], wrong: [], lockUntil: 0, tauntUntil: 0 });

/** Pokémon of `pool` still possible for this seat. */
export const aliveOf = (pool: readonly Pokemon[], seat: Pick<WhoamiSeat, "known" | "wrong">) => pool.filter((p) => !seat.wrong.includes(p.id) && fits(seat.known, p)).map((p) => p.id);

/** Learns a fact (a won clue, a traced question) for free; nothing if already known. */
export function learn(seat: WhoamiSeat, q: string, yes: boolean, via: WhoamiKnown["via"]) {
  if (!seat.known.some((k) => k.q === q)) seat.known.push({ q, yes, via });
}

/** Asks question `qid` about `secret`: pays its PP and learns the answer. Changes `seat`. */
export function askSeat(seat: WhoamiSeat, secret: Pokemon, qid: string, now: number): { ok: true; yes: boolean } | Fail {
  const q = parseQuestion(qid);
  if (!q) return fail(400, "That isn't a question on the menu.");
  if (seat.solvedAt !== undefined) return fail(409, "You've already solved it.");
  if (now < seat.lockUntil) return fail(409, "Locked out after a wrong guess.");
  if (now < seat.tauntUntil) return fail(409, "You've been taunted: no questions for a moment.");
  if (seat.known.some((k) => k.q === qid)) return fail(409, "You already know that.");
  const cost = questionCost(q);
  if (seat.pp < cost) return fail(409, seat.pp === 0 ? "Out of PP: you can only guess." : "Not enough PP for that question.");
  seat.pp -= cost;
  const yes = answer(q, secret);
  seat.known.push({ q: qid, yes, via: "ask" });
  return { ok: true, yes };
}

/** Guesses Pokémon `id` (from `pool`). Right: solved. Wrong: no PP, but a lockout. Changes `seat`. */
export function guessSeat(seat: WhoamiSeat, secret: Pokemon, id: number, pool: readonly Pokemon[], now: number): { ok: true; right: boolean } | Fail {
  if (seat.solvedAt !== undefined) return fail(409, "You've already solved it.");
  if (now < seat.lockUntil) return fail(409, "Locked out after a wrong guess.");
  if (!pool.some((p) => p.id === id)) return fail(400, "That Pokémon isn't in this game.");
  if (seat.wrong.includes(id)) return fail(409, "You've already guessed that one.");
  if (id === secret.id) {
    seat.solvedAt = now;
    return { ok: true, right: true };
  }
  seat.wrong.push(id);
  seat.lockUntil = now + WHOAMI_LOCK_MS;
  return { ok: true, right: false };
}

export const seatScore = (seat: WhoamiSeat) => (seat.solvedAt !== undefined ? whoamiScore(seat.pp) : 0);

export function mineOf(seat: WhoamiSeat, pool: readonly Pokemon[]): WhoamiMine {
  return { pp: seat.pp, known: seat.known, alive: aliveOf(pool, seat), wrong: seat.wrong, lockUntil: seat.lockUntil };
}

/** A clue of `kind` about `secret`: a true fact, drawn by `rng`. */
export function clueFact(kind: WhoamiClueKind, secret: Pokemon, rng: Rng): string {
  if (kind === "gen") return `gen:${secret.gen}`;
  if (kind === "type") return `type:${rng.pick(secret.types)}`;
  return `ability:${rng.pick(secret.abilities).name}`;
}

// ---------------------------------------------------------------------------
// Practice and the daily
// ---------------------------------------------------------------------------

/** Practice state, sealed (encrypted) in a token the browser carries: it never sees the secret. */
interface SoloState {
  m: "daily" | "practice";
  d?: string;
  s: WhoamiPoolSettings;
  x: number;
  t: number;
  seat: WhoamiSeat;
}

const DAILY_SETTINGS: WhoamiPoolSettings = { from: 1, to: MAX_GEN_WHOAMI, casual: false };

/** The daily's secret on `date`: the same for everyone, keyed by the server secret so the code can't predict it. */
export function dailySecret(date: string): Pokemon {
  const pool = poolOf(DAILY_SETTINGS);
  return pool[hashString(deriveSeed("whoami", `daily:${date}`)) % pool.length];
}

export function startSolo(mode: "daily" | "practice", settings: WhoamiPoolSettings, now: number, date?: string): SoloState {
  const s = mode === "daily" ? DAILY_SETTINGS : settings;
  const x = mode === "daily" ? dailySecret(date!).id : new Rng(hashString(randomId())).pick(poolOf(s)).id;
  return { m: mode, ...(mode === "daily" && { d: date }), s, x, t: now, seat: newSeatPlay() };
}

export const sealSolo = (state: SoloState) => encryptJson(state);
export const openSolo = (token: string): SoloState | null => decryptJson<SoloState>(token);

const soloOver = (st: SoloState, now: number) => st.seat.solvedAt !== undefined || now >= st.t + WHOAMI_ROUND_MS;

export function soloAct(st: SoloState, move: { ask: string } | { guess: number }, now: number): { ok: true; state: SoloState } | Fail {
  if (soloOver(st, now)) return fail(409, "This game is over.");
  const next = structuredClone(st);
  const secret = getPokemon(st.x)!;
  const out = "ask" in move ? askSeat(next.seat, secret, move.ask, now) : guessSeat(next.seat, secret, move.guess, poolOf(st.s), now);
  return out.ok ? { ok: true, state: next } : out;
}

export function soloView(st: SoloState, now: number): WhoamiSoloView {
  const pool = poolOf(st.s);
  const secret = getPokemon(st.x)!;
  return {
    mode: st.m,
    ...(st.d && { date: st.d }),
    settings: st.s,
    pool: pool.map((p) => p.id),
    ...mineOf(st.seat, pool),
    startedAt: st.t,
    endsAt: st.t + WHOAMI_ROUND_MS,
    now,
    ...(st.seat.solvedAt !== undefined && { solvedAt: st.seat.solvedAt, score: seatScore(st.seat) }),
    ...(soloOver(st, now) && { answer: { id: secret.id, name: secret.name, genus: secret.genus } }),
  };
}
