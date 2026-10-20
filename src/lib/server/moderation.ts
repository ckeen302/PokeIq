import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { PERMANENT, type AuditEntry, type Sanction } from "@/lib/moderation";
import { createHash } from "node:crypto";
import { getSessionUser, type PublicUser } from "./accounts";
import { SESSION_COOKIE, sessionTokenHash, userFromRequest } from "./auth";

/**
 * Moderators and what they decide (migration 0020):
 *
 * - Admins are the accounts named in POKEIQ_ADMINS (comma-separated
 *   usernames; empty by default, so nobody is), checked on the server for
 *   every admin page and action.
 * - A mute stops a trainer chatting anywhere (battles, duels, rooms) until
 *   it ends; a ban also stops PvP (battles, duels, matchmaking,
 *   tournaments) and friend requests and challenges. Both are checked on the
 *   server at each of those doors (`gate`).
 * - Every moderator action goes in the audit log.
 *
 * Before the migration nobody is muted or banned (the checks pass) and the
 * admin actions say the tables are missing.
 */

export class ModerationUnavailable extends Error {}

export function adminNames(): string[] {
  return (process.env.POKEIQ_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdmin = (user: PublicUser | null | undefined): boolean => !!user && adminNames().includes(user.username.toLowerCase());

/** The signed-in admin making this request, or null (not signed in, or not an admin). */
export async function adminFromRequest(request: NextRequest): Promise<PublicUser | null> {
  if (!sessionTokenHash(request) || !adminNames().length) return null;
  const user = await userFromRequest(request).catch(() => null);
  return isAdmin(user) ? user : null;
}

/** For server pages: the signed-in admin viewing it (from the session cookie), or null. */
export async function adminFromCookies(): Promise<PublicUser | null> {
  if (!adminNames().length) return null;
  const { cookies } = await import("next/headers");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const user = await getSessionUser(createHash("sha256").update(token).digest("hex")).catch(() => null);
  return isAdmin(user) ? user : null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ModStore {
  sanction(userId: string): Promise<Sanction | null>;
  setSanction(s: Sanction): Promise<void>;
  log(entry: Omit<AuditEntry, "id">): Promise<void>;
  audit(limit: number): Promise<AuditEntry[]>;
}

const globalStore = globalThis as unknown as { __pokeiqMod?: { sanctions: Map<string, Sanction>; audit: AuditEntry[] } };
type ModDb = { sanctions: Map<string, Sanction>; audit: AuditEntry[] };
const mem = (): ModDb => (globalStore.__pokeiqMod ??= { sanctions: new Map(), audit: [] });

export function clearMemoryModeration() {
  globalStore.__pokeiqMod = { sanctions: new Map(), audit: [] };
  cache.clear();
}

export function memoryModStore(): ModStore {
  return {
    async sanction(userId) {
      const s = mem().sanctions.get(userId);
      return s ? { ...s } : null;
    },
    async setSanction(s) {
      mem().sanctions.set(s.userId, { ...s });
    },
    async log(entry) {
      const db = mem();
      db.audit.unshift({ id: (db.audit[0]?.id ?? 0) + 1, ...entry });
      db.audit.length = Math.min(db.audit.length, 500);
    },
    async audit(limit) {
      return mem().audit.slice(0, limit);
    },
  };
}

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")) throw new ModerationUnavailable(error.message);
  throw new Error(error.message);
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function supabaseModStore(sb: Sb): ModStore {
  return {
    async sanction(userId) {
      const { data, error } = await sb
        .from("user_sanctions")
        .select("user_id, username, muted_until, banned, ban_reason, updated_at, updated_by")
        .eq("user_id", userId)
        .maybeSingle<{ user_id: string; username: string; muted_until: string | null; banned: boolean; ban_reason: string | null; updated_at: string; updated_by: string }>();
      check(error);
      if (!data) return null;
      return {
        userId: data.user_id,
        username: data.username,
        mutedUntil: data.muted_until ? Date.parse(data.muted_until) : null,
        banned: data.banned,
        banReason: data.ban_reason,
        updatedAt: Date.parse(data.updated_at),
        updatedBy: data.updated_by,
      };
    },
    async setSanction(s) {
      const { error } = await sb.from("user_sanctions").upsert({
        user_id: s.userId,
        username: s.username,
        muted_until: iso(s.mutedUntil),
        banned: s.banned,
        ban_reason: s.banReason,
        updated_at: iso(s.updatedAt),
        updated_by: s.updatedBy,
      });
      check(error);
    },
    async log(entry) {
      const { error } = await sb.from("mod_actions").insert({ created_at: iso(entry.at), admin: entry.admin, action: entry.action, target: entry.target, detail: entry.detail });
      check(error);
    },
    async audit(limit) {
      const { data, error } = await sb.from("mod_actions").select("id, created_at, admin, action, target, detail").order("id", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as { id: number; created_at: string; admin: string; action: string; target: string; detail: string | null }[]).map((r) => ({
        id: r.id,
        at: Date.parse(r.created_at),
        admin: r.admin,
        action: r.action,
        target: r.target,
        detail: r.detail,
      }));
    },
  };
}

export function modStore(): ModStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryModStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseModStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryModStore() : null;
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/** What a sanction stops: chatting (mute or ban), playing PvP or using friends (ban). */
export type Need = "chat" | "play" | "social";

/** Sanctions are read at most every 15 s per instance per trainer (a moderator's own instance sees changes at once). */
const CACHE_MS = 15_000;
const cache = new Map<string, { s: Sanction | null; at: number }>();

export async function sanctionOf(userId: string, now = Date.now()): Promise<Sanction | null> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < CACHE_MS) return hit.s;
  let s: Sanction | null = null;
  try {
    s = (await modStore()?.sanction(userId)) ?? null;
  } catch (err) {
    // Before the migration nobody is sanctioned; any other failure lets the trainer through rather than breaking the game.
    if (!(err instanceof ModerationUnavailable)) console.error("[moderation] sanction lookup failed:", err);
  }
  if (cache.size > 5000) cache.clear();
  cache.set(userId, { s, at: now });
  return s;
}

/** Why `s` stops `need` at `now`, or null. */
export function blockedReason(s: Sanction | null, need: Need, now = Date.now()): string | null {
  if (!s) return null;
  if (s.banned) return `Your account is banned${s.banReason ? `: ${s.banReason}` : ""}.`;
  if (need === "chat" && s.mutedUntil !== null && s.mutedUntil > now) {
    return s.mutedUntil >= PERMANENT ? "You've been muted by a moderator." : `You've been muted by a moderator until ${new Date(s.mutedUntil).toUTCString().replace(/:\d\d GMT$/, " UTC")}.`;
  }
  return null;
}

/** Why `user` can't do `need` right now, or null. */
export async function userBlocked(user: PublicUser | null, need: Need): Promise<string | null> {
  return user ? blockedReason(await sanctionOf(user.id), need) : null;
}

/** For routes: a 403 if the signed-in trainer sending this request is muted or banned for `need`; null otherwise (guests too). */
export async function gate(request: NextRequest, need: Need): Promise<NextResponse | null> {
  if (!sessionTokenHash(request)) return null;
  const user = await userFromRequest(request).catch(() => null);
  const reason = await userBlocked(user, need);
  return reason ? NextResponse.json({ error: reason, sanctioned: true }, { status: 403, headers: { "Cache-Control": "no-store" } }) : null;
}

/** A moderator changes a trainer's sanction (and it applies at once on this instance). */
export async function setSanction(s: Sanction): Promise<void> {
  const store = modStore();
  if (!store) throw new ModerationUnavailable("No store.");
  await store.setSanction(s);
  cache.set(s.userId, { s, at: Date.now() });
}

export async function audit(admin: PublicUser, action: string, target: string, detail: string | null = null): Promise<void> {
  try {
    await modStore()?.log({ at: Date.now(), admin: admin.username, action, target, detail });
  } catch (err) {
    console.error("[moderation] audit log failed:", err);
  }
}
