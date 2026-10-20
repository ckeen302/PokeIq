import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Trainer accounts, login sessions and synced progress.
 *
 * Production stores everything in Supabase (RLS-locked tables, service-role
 * key only). Local development without Supabase falls back to a JSON file in
 * .data/ so sign-up works with zero setup. In production without Supabase,
 * accounts are switched off rather than silently losing data (set
 * POKEIQ_LOCAL_ACCOUNTS=1 to use the file store in a local production build).
 */

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  recoveryCodeHash: string | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

interface SessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function accountsEnabled(): boolean {
  return (
    getServiceSupabase() !== null ||
    process.env.NODE_ENV !== "production" ||
    // Lets a local production build (E2E tests) use the file store.
    process.env.POKEIQ_LOCAL_ACCOUNTS === "1"
  );
}

// ---------------------------------------------------------------------------
// Dev file backend
// ---------------------------------------------------------------------------

interface FileDb {
  users: UserRecord[];
  sessions: SessionRecord[];
  progress: Record<string, unknown>;
}

const DB_PATH = path.join(process.cwd(), ".data", "pokeiq-accounts.json");
const globalDb = globalThis as unknown as { __pokeiqAccounts?: FileDb };

function fileDb(): FileDb {
  if (globalDb.__pokeiqAccounts) return globalDb.__pokeiqAccounts;
  let db: FileDb = { users: [], sessions: [], progress: {} };
  try {
    db = { ...db, ...(JSON.parse(readFileSync(DB_PATH, "utf8")) as FileDb) };
  } catch {
    // No file yet.
  }
  globalDb.__pokeiqAccounts = db;
  return db;
}

function saveFileDb(): void {
  const db = fileDb();
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, DB_PATH);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  username: string;
  password_hash: string;
  recovery_code_hash: string | null;
  created_at: string;
}

function fromRow(row: ProfileRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    recoveryCodeHash: row.recovery_code_hash,
    createdAt: row.created_at,
  };
}

/** Returns "taken" if the name is already in use (case-insensitively). */
export async function createUser(user: UserRecord): Promise<UserRecord | "taken"> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("profiles").insert({
      id: user.id,
      username: user.username,
      username_lower: user.username.toLowerCase(),
      password_hash: user.passwordHash,
      recovery_code_hash: user.recoveryCodeHash,
      created_at: user.createdAt,
    });
    if (error?.code === "23505") return "taken";
    if (error) throw new Error(error.message);
    return user;
  }
  const db = fileDb();
  if (db.users.some((u) => u.username.toLowerCase() === user.username.toLowerCase())) return "taken";
  db.users.push(user);
  saveFileDb();
  return user;
}

export async function findUserByName(username: string): Promise<UserRecord | null> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, password_hash, recovery_code_hash, created_at")
      .eq("username_lower", username.toLowerCase())
      .maybeSingle<ProfileRow>();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : null;
  }
  return fileDb().users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
}

export async function updateCredentials(
  userId: string,
  changes: { passwordHash?: string; recoveryCodeHash?: string }
): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb
      .from("profiles")
      .update({
        ...(changes.passwordHash && { password_hash: changes.passwordHash }),
        ...(changes.recoveryCodeHash && { recovery_code_hash: changes.recoveryCodeHash }),
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  const user = fileDb().users.find((u) => u.id === userId);
  if (!user) return;
  if (changes.passwordHash) user.passwordHash = changes.passwordHash;
  if (changes.recoveryCodeHash) user.recoveryCodeHash = changes.recoveryCodeHash;
  saveFileDb();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    // Opportunistic cleanup keeps the table small without a cron job.
    await sb.from("auth_sessions").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
    const { error } = await sb
      .from("auth_sessions")
      .insert({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString() });
    if (error) throw new Error(error.message);
    return;
  }
  const db = fileDb();
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => Date.parse(s.expiresAt) > now);
  db.sessions.push({ tokenHash, userId, expiresAt: expiresAt.toISOString() });
  saveFileDb();
}

export async function getSessionUser(tokenHash: string): Promise<PublicUser | null> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("auth_sessions")
      .select("expires_at, profiles (id, username, created_at)")
      .eq("token_hash", tokenHash)
      .maybeSingle<{ expires_at: string; profiles: { id: string; username: string; created_at: string } | null }>();
    if (error || !data?.profiles || Date.parse(data.expires_at) <= Date.now()) return null;
    return { id: data.profiles.id, username: data.profiles.username, createdAt: data.profiles.created_at };
  }
  const db = fileDb();
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = db.users.find((u) => u.id === session.userId);
  return user ? toPublicUser(user) : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    await sb.from("auth_sessions").delete().eq("token_hash", tokenHash);
    return;
  }
  const db = fileDb();
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
  saveFileDb();
}

/** Signs the trainer out everywhere, e.g. after a password reset. */
export async function deleteUserSessions(userId: string): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    await sb.from("auth_sessions").delete().eq("user_id", userId);
    return;
  }
  const db = fileDb();
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  saveFileDb();
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export async function loadProgress(userId: string): Promise<unknown | null> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("user_progress")
      .select("progress")
      .eq("user_id", userId)
      .maybeSingle<{ progress: unknown }>();
    if (error) throw new Error(error.message);
    return data?.progress ?? null;
  }
  return fileDb().progress[userId] ?? null;
}

export async function saveProgress(userId: string, progress: unknown): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb
      .from("user_progress")
      .upsert({ user_id: userId, progress, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return;
  }
  fileDb().progress[userId] = progress;
  saveFileDb();
}

// ---------------------------------------------------------------------------
// Looking trainers up (friends, find a user)
// ---------------------------------------------------------------------------

export async function findUserById(id: string): Promise<PublicUser | null> {
  return (await usersByIds([id]))[0] ?? null;
}

/** Accounts by id (unknown ids are left out). */
export async function usersByIds(ids: string[]): Promise<PublicUser[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb.from("profiles").select("id, username, created_at").in("id", unique);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { id: string; username: string; created_at: string }) => ({ id: r.id, username: r.username, createdAt: r.created_at }));
  }
  const wanted = new Set(unique);
  return fileDb().users.filter((u) => wanted.has(u.id)).map(toPublicUser);
}

/** Usernames starting with `prefix` (case-insensitive), alphabetically. */
export async function searchUsers(prefix: string, limit = 20): Promise<string[]> {
  const lower = prefix.toLowerCase();
  const sb = getServiceSupabase();
  if (sb) {
    // `_` is a LIKE wildcard and may be part of a name: escape it (and `\`, `%`, which names can't hold anyway).
    const pattern = `${lower.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data, error } = await sb.from("profiles").select("username").like("username_lower", pattern).order("username_lower").limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { username: string }) => r.username);
  }
  return fileDb()
    .users.filter((u) => u.username.toLowerCase().startsWith(lower))
    .map((u) => u.username)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, limit);
}

/** The public bits of accounts' synced progress: XP and the two dailies. */
export interface ProgressDigest {
  xp: number;
  daily: unknown;
  dle: unknown;
}

export async function progressDigests(ids: string[]): Promise<Map<string, ProgressDigest>> {
  const out = new Map<string, ProgressDigest>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb.from("user_progress").select("user_id, xp:progress->xp, daily:progress->daily, dle:progress->dle").in("user_id", unique);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { user_id: string; xp: unknown; daily: unknown; dle: unknown }[]) {
      out.set(r.user_id, { xp: typeof r.xp === "number" ? r.xp : 0, daily: r.daily, dle: r.dle });
    }
    return out;
  }
  for (const id of unique) {
    const p = fileDb().progress[id] as { xp?: unknown; daily?: unknown; dle?: unknown } | undefined;
    if (p) out.set(id, { xp: typeof p.xp === "number" ? p.xp : 0, daily: p.daily, dle: p.dle });
  }
  return out;
}
