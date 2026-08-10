/**
 * User, session and stats persistence.
 *
 * Same graceful-degradation philosophy as the leaderboard store:
 *  - Supabase Postgres when `SUPABASE_SERVICE_ROLE_KEY` is configured
 *    (auth tables are RLS-locked to the service role — the anon key can
 *    never read password or session hashes).
 *  - Otherwise a file-backed JSON store at .data/pokeiq-auth.json, written
 *    atomically (temp file + rename), so local accounts survive restarts
 *    with zero configuration.
 *
 * Server-only module — never import from client components.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { QuizCategory } from "@/engines/types";
import { getSupabaseAdmin } from "./supabase";

export interface UserRecord {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  /** SHA-256 of the one-time recovery code (absent on legacy accounts). */
  recoveryCodeHash?: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface ServerStats {
  gamesPlayed: number;
  totalCorrect: number;
  totalAnswered: number;
  bestStreak: number;
  survivalBest: number;
  /** lifetime XP — sum of every finished run's score */
  totalScore: number;
  bestScores: Partial<Record<QuizCategory, number>>;
}

export interface StatsDelta {
  category: string;
  mode: "classic" | "survival" | "daily";
  score: number;
  correctCount: number;
  totalQuestions: number;
  bestStreak: number;
}

export interface TrainerRanking {
  username: string;
  stats: ServerStats;
}

const EMPTY_STATS: ServerStats = {
  gamesPlayed: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  bestStreak: 0,
  survivalBest: 0,
  totalScore: 0,
  bestScores: {},
};

function applyDelta(stats: ServerStats, delta: StatsDelta): ServerStats {
  const next: ServerStats = {
    ...stats,
    gamesPlayed: stats.gamesPlayed + 1,
    totalCorrect: stats.totalCorrect + delta.correctCount,
    totalAnswered: stats.totalAnswered + delta.totalQuestions,
    bestStreak: Math.max(stats.bestStreak, delta.bestStreak),
    survivalBest:
      delta.mode === "survival"
        ? Math.max(stats.survivalBest, delta.correctCount)
        : stats.survivalBest,
    totalScore: stats.totalScore + delta.score,
    bestScores: { ...stats.bestScores },
  };
  if (delta.mode === "classic" && delta.category !== "daily") {
    const category = delta.category as QuizCategory;
    next.bestScores[category] = Math.max(
      next.bestScores[category] ?? 0,
      delta.score,
    );
  }
  return next;
}

function toPublic(user: UserRecord): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

/* ------------------------------------------------------------------ */
/* File backend                                                        */
/* ------------------------------------------------------------------ */

interface FileDb {
  users: UserRecord[];
  sessions: SessionRecord[];
  stats: Record<string, ServerStats>;
}

const DB_PATH = path.join(process.cwd(), ".data", "pokeiq-auth.json");

// Anchored on globalThis so API-route bundles share one in-memory view.
const globalDb = globalThis as unknown as { __pokeiqAuthDb?: FileDb };

function loadDb(): FileDb {
  if (globalDb.__pokeiqAuthDb) return globalDb.__pokeiqAuthDb;
  let db: FileDb = { users: [], sessions: [], stats: {} };
  try {
    db = { ...db, ...JSON.parse(readFileSync(DB_PATH, "utf8")) };
  } catch {
    // first run — no file yet
  }
  globalDb.__pokeiqAuthDb = db;
  return db;
}

function persistDb(db: FileDb): void {
  try {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, DB_PATH); // atomic on POSIX — no torn writes
  } catch (error) {
    console.error("[auth-store] persist failed:", error);
  }
}

function pruneExpired(db: FileDb): void {
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => Date.parse(s.expiresAt) > now);
}

/* ------------------------------------------------------------------ */
/* Public API — Supabase when configured, file otherwise               */
/* ------------------------------------------------------------------ */

export async function findUserByUsername(
  username: string,
): Promise<UserRecord | null> {
  const lower = username.toLowerCase();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, username_lower, password_hash, created_at")
      .eq("username_lower", lower)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      username: data.username,
      usernameLower: data.username_lower,
      passwordHash: data.password_hash,
      createdAt: data.created_at,
    };
  }
  const db = loadDb();
  return db.users.find((u) => u.usernameLower === lower) ?? null;
}

export async function createUser(user: UserRecord): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from("profiles").insert({
      id: user.id,
      username: user.username,
      username_lower: user.usernameLower,
      password_hash: user.passwordHash,
      recovery_code_hash: user.recoveryCodeHash ?? null,
    });
    return !error;
  }
  const db = loadDb();
  if (db.users.some((u) => u.usernameLower === user.usernameLower)) {
    return false;
  }
  db.users.push(user);
  persistDb(db);
  return true;
}

/** Find the account a recovery code belongs to (exact hash match). */
export async function findUserByRecoveryHash(
  recoveryHash: string,
): Promise<UserRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, username_lower, password_hash, created_at")
      .eq("recovery_code_hash", recoveryHash)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      username: data.username,
      usernameLower: data.username_lower,
      passwordHash: data.password_hash,
      recoveryCodeHash: recoveryHash,
      createdAt: data.created_at,
    };
  }
  const db = loadDb();
  return db.users.find((u) => u.recoveryCodeHash === recoveryHash) ?? null;
}

/** Rotate password + recovery code after a successful recovery. */
export async function resetCredentials(
  userId: string,
  passwordHash: string,
  recoveryCodeHash: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from("profiles")
      .update({
        password_hash: passwordHash,
        recovery_code_hash: recoveryCodeHash,
      })
      .eq("id", userId);
    return;
  }
  const db = loadDb();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.passwordHash = passwordHash;
    user.recoveryCodeHash = recoveryCodeHash;
    persistDb(db);
  }
}

/** Revoke every live session for a user (called on password reset). */
export async function deleteSessionsForUser(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("sessions").delete().eq("user_id", userId);
    return;
  }
  const db = loadDb();
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  persistDb(db);
}

export async function createSession(session: SessionRecord): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("sessions").insert({
      token_hash: session.tokenHash,
      user_id: session.userId,
      expires_at: session.expiresAt,
    });
    return;
  }
  const db = loadDb();
  pruneExpired(db);
  db.sessions.push(session);
  persistDb(db);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("sessions").delete().eq("token_hash", tokenHash);
    return;
  }
  const db = loadDb();
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
  persistDb(db);
}

/** Resolve a live (unexpired) session to its user. */
export async function getSessionUser(
  tokenHash: string,
): Promise<PublicUser | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: session } = await supabase
      .from("sessions")
      .select("user_id, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!session || Date.parse(session.expires_at) < Date.now()) return null;
    const { data: user } = await supabase
      .from("profiles")
      .select("id, username, created_at")
      .eq("id", session.user_id)
      .maybeSingle();
    return user
      ? { id: user.id, username: user.username, createdAt: user.created_at }
      : null;
  }
  const db = loadDb();
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
  const user = db.users.find((u) => u.id === session.userId);
  return user ? toPublic(user) : null;
}

export async function getStats(userId: string): Promise<ServerStats> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase
      .from("user_stats")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return EMPTY_STATS;
    return {
      gamesPlayed: data.games_played,
      totalCorrect: data.total_correct,
      totalAnswered: data.total_answered,
      bestStreak: data.best_streak,
      survivalBest: data.survival_best,
      totalScore: data.total_score,
      bestScores: data.best_scores ?? {},
    };
  }
  return loadDb().stats[userId] ?? EMPTY_STATS;
}

export async function recordStats(
  userId: string,
  delta: StatsDelta,
): Promise<ServerStats> {
  const current = await getStats(userId);
  const next = applyDelta(current, delta);
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("user_stats").upsert({
      user_id: userId,
      games_played: next.gamesPlayed,
      total_correct: next.totalCorrect,
      total_answered: next.totalAnswered,
      best_streak: next.bestStreak,
      survival_best: next.survivalBest,
      total_score: next.totalScore,
      best_scores: next.bestScores,
      updated_at: new Date().toISOString(),
    });
    return next;
  }
  const db = loadDb();
  db.stats[userId] = next;
  persistDb(db);
  return next;
}

/** Top trainers by lifetime XP — the "how do I stack up" ranking. */
export async function getTopTrainers(limit = 10): Promise<TrainerRanking[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase
      .from("user_stats")
      .select(
        "total_score, games_played, total_correct, total_answered, best_streak, survival_best, best_scores, profiles(username)",
      )
      .order("total_score", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      username:
        (row.profiles as unknown as { username: string } | null)?.username ??
        "???",
      stats: {
        gamesPlayed: row.games_played,
        totalCorrect: row.total_correct,
        totalAnswered: row.total_answered,
        bestStreak: row.best_streak,
        survivalBest: row.survival_best,
        totalScore: row.total_score,
        bestScores: row.best_scores ?? {},
      },
    }));
  }
  const db = loadDb();
  return Object.entries(db.stats)
    .map(([userId, stats]) => ({
      username: db.users.find((u) => u.id === userId)?.username ?? "???",
      stats,
    }))
    .sort((a, b) => b.stats.totalScore - a.stats.totalScore)
    .slice(0, limit);
}

/** Global standing by lifetime XP: rank N of M ranked trainers. */
export async function getRank(
  userId: string,
): Promise<{ rank: number; of: number } | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: mine } = await supabase
      .from("user_stats")
      .select("total_score")
      .eq("user_id", userId)
      .maybeSingle();
    if (!mine) return null;
    const [{ count: above }, { count: total }] = await Promise.all([
      supabase
        .from("user_stats")
        .select("*", { count: "exact", head: true })
        .gt("total_score", mine.total_score),
      supabase.from("user_stats").select("*", { count: "exact", head: true }),
    ]);
    return { rank: (above ?? 0) + 1, of: total ?? 1 };
  }
  const db = loadDb();
  const mine = db.stats[userId];
  if (!mine) return null;
  const scores = Object.values(db.stats).map((s) => s.totalScore);
  const above = scores.filter((s) => s > mine.totalScore).length;
  return { rank: above + 1, of: scores.length };
}

/** Set a fresh recovery-code hash (for legacy accounts / lost codes). */
export async function setRecoveryCode(
  userId: string,
  recoveryCodeHash: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from("profiles")
      .update({ recovery_code_hash: recoveryCodeHash })
      .eq("id", userId);
    return;
  }
  const db = loadDb();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.recoveryCodeHash = recoveryCodeHash;
    persistDb(db);
  }
}

/** True when accounts persist beyond this process (Supabase configured). */
export function accountsPersistent(): boolean {
  return getSupabaseAdmin() !== null;
}
