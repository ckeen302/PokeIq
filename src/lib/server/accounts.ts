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
  identities?: IdentityRecord[];
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

/** Removes a profile (and, by cascade, its sessions and identities). Only for undoing a half-made signup. */
export async function deleteProfile(id: string): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("profiles").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  const db = fileDb();
  db.users = db.users.filter((u) => u.id !== id);
  db.sessions = db.sessions.filter((s) => s.userId !== id);
  db.identities = (db.identities ?? []).filter((i) => i.profileId !== id);
  saveFileDb();
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

export async function findUserRecordById(id: string): Promise<UserRecord | null> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, password_hash, recovery_code_hash, created_at")
      .eq("id", id)
      .maybeSingle<ProfileRow>();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : null;
  }
  return fileDb().users.find((u) => u.id === id) ?? null;
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
// Sign-in identities (Discord / Google). Emails here are private to the owner.
// ---------------------------------------------------------------------------

export interface IdentityRecord {
  provider: string;
  providerUserId: string;
  profileId: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IdentityRow {
  provider: string;
  provider_user_id: string;
  profile_id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

const IDENTITY_COLUMNS = "provider, provider_user_id, profile_id, email, created_at, updated_at";

const fromIdentityRow = (r: IdentityRow): IdentityRecord => ({
  provider: r.provider,
  providerUserId: r.provider_user_id,
  profileId: r.profile_id,
  email: r.email,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function findIdentity(provider: string, providerUserId: string): Promise<IdentityRecord | null> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("auth_identities")
      .select(IDENTITY_COLUMNS)
      .eq("provider", provider)
      .eq("provider_user_id", providerUserId)
      .maybeSingle<IdentityRow>();
    if (error) throw new Error(error.message);
    return data ? fromIdentityRow(data) : null;
  }
  return (fileDb().identities ?? []).find((i) => i.provider === provider && i.providerUserId === providerUserId) ?? null;
}

export async function identitiesOf(profileId: string): Promise<IdentityRecord[]> {
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb.from("auth_identities").select(IDENTITY_COLUMNS).eq("profile_id", profileId).order("created_at");
    if (error) throw new Error(error.message);
    return ((data ?? []) as IdentityRow[]).map(fromIdentityRow);
  }
  return (fileDb().identities ?? []).filter((i) => i.profileId === profileId);
}

/** "conflict" if that provider account, or this provider on this profile, is already linked. */
export async function insertIdentity(rec: IdentityRecord): Promise<IdentityRecord | "conflict"> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("auth_identities").insert({
      provider: rec.provider,
      provider_user_id: rec.providerUserId,
      profile_id: rec.profileId,
      email: rec.email,
      created_at: rec.createdAt,
      updated_at: rec.updatedAt,
    });
    if (error?.code === "23505") return "conflict";
    if (error) throw new Error(error.message);
    return rec;
  }
  const db = fileDb();
  const list = (db.identities ??= []);
  if (list.some((i) => (i.provider === rec.provider && i.providerUserId === rec.providerUserId) || (i.profileId === rec.profileId && i.provider === rec.provider))) {
    return "conflict";
  }
  list.push(rec);
  saveFileDb();
  return rec;
}

/** Keeps the stored verified email current after a sign-in. */
export async function touchIdentity(provider: string, providerUserId: string, email: string | null): Promise<void> {
  const updatedAt = new Date().toISOString();
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("auth_identities").update({ email, updated_at: updatedAt }).eq("provider", provider).eq("provider_user_id", providerUserId);
    if (error) throw new Error(error.message);
    return;
  }
  const rec = (fileDb().identities ?? []).find((i) => i.provider === provider && i.providerUserId === providerUserId);
  if (!rec) return;
  rec.email = email;
  rec.updatedAt = updatedAt;
  saveFileDb();
}

export async function deleteIdentity(profileId: string, provider: string): Promise<void> {
  const sb = getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("auth_identities").delete().eq("profile_id", profileId).eq("provider", provider);
    if (error) throw new Error(error.message);
    return;
  }
  const db = fileDb();
  db.identities = (db.identities ?? []).filter((i) => !(i.profileId === profileId && i.provider === provider));
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

/** Accounts by name, case-insensitively (unknown names are left out). */
export async function usersByNames(names: string[]): Promise<PublicUser[]> {
  const unique = [...new Set(names.map((n) => n.toLowerCase()))];
  if (!unique.length) return [];
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb.from("profiles").select("id, username, created_at").in("username_lower", unique);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { id: string; username: string; created_at: string }) => ({ id: r.id, username: r.username, createdAt: r.created_at }));
  }
  const wanted = new Set(unique);
  return fileDb().users.filter((u) => wanted.has(u.username.toLowerCase())).map(toPublicUser);
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
  /** PokéConnections: the daily streak ({ last, streak, best }, never the results) and the tallies (lib/connections/play). Untrusted shapes. */
  conn?: { last: unknown; streak: unknown; best: unknown } | null;
  connPlay?: unknown;
  /** Badges earned (how many). */
  badges?: number;
  /** The per-mode best scores ("<module>:<format>" -> score), only when asked for (the profile). Untrusted shape. */
  best?: unknown;
}

const badgeCount = (b: unknown) => (b && typeof b === "object" && !Array.isArray(b) ? Object.keys(b).length : 0);

export async function progressDigests(ids: string[], opts: { bests?: boolean } = {}): Promise<Map<string, ProgressDigest>> {
  const out = new Map<string, ProgressDigest>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const sb = getServiceSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("user_progress")
      .select(
        `user_id, xp:progress->xp, daily:progress->daily, dle:progress->dle, connLast:progress->conn->last, connStreak:progress->conn->streak, connBest:progress->conn->best, connPlay:progress->connPlay, badges:progress->badges${opts.bests ? ", best:progress->best" : ""}`
      )
      .in("user_id", unique);
    if (error) throw new Error(error.message);
    type Row = { user_id: string; xp: unknown; daily: unknown; dle: unknown; connLast: unknown; connStreak: unknown; connBest: unknown; connPlay: unknown; badges: unknown; best?: unknown };
    for (const r of (data ?? []) as unknown as Row[]) {
      out.set(r.user_id, {
        xp: typeof r.xp === "number" ? r.xp : 0,
        daily: r.daily,
        dle: r.dle,
        conn: r.connLast === null && r.connStreak === null ? null : { last: r.connLast, streak: r.connStreak, best: r.connBest },
        connPlay: r.connPlay,
        badges: badgeCount(r.badges),
        ...(opts.bests && { best: r.best }),
      });
    }
    return out;
  }
  for (const id of unique) {
    const p = fileDb().progress[id] as { xp?: unknown; daily?: unknown; dle?: unknown; conn?: { last?: unknown; streak?: unknown; best?: unknown }; connPlay?: unknown; badges?: unknown; best?: unknown } | undefined;
    if (p) {
      out.set(id, {
        xp: typeof p.xp === "number" ? p.xp : 0,
        daily: p.daily,
        dle: p.dle,
        conn: p.conn ? { last: p.conn.last, streak: p.conn.streak, best: p.conn.best } : null,
        connPlay: p.connPlay,
        badges: badgeCount(p.badges),
        ...(opts.bests && { best: p.best }),
      });
    }
  }
  return out;
}
