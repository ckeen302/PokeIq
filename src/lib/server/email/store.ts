import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Email subscriptions (migration 0055): Supabase in production, a JSON file
 * in .data/ for local and e2e runs (like the accounts store). Before the
 * migration is applied, reads find nothing and writes throw EmailUnavailable,
 * so nothing crashes.
 */

export interface EmailSub {
  profileId: string;
  email: string;
  verifiedAt: string | null;
  dailyEmail: boolean;
  /** Only send on days a daily streak is at risk. */
  streakNudge: boolean;
  /** The daily (YYYY-MM-DD) of the last daily email. */
  lastSentOn: string | null;
  confirmSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailStore {
  get(profileId: string): Promise<EmailSub | null>;
  save(sub: EmailSub): Promise<void>;
  /** Confirmed, opted-in rows not yet sent `today`'s email. */
  candidates(today: string): Promise<EmailSub[]>;
  /** Marks these as sent today, atomically per row: the ids it claimed (not already sent today). */
  claim(ids: string[], today: string): Promise<string[]>;
  /** Undoes a claim whose send failed, so a re-run sends them. */
  release(ids: string[], today: string): Promise<void>;
}

export class EmailUnavailable extends Error {}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
let warned = false;
function missing(error: { code?: string; message: string }): boolean {
  if (!MISSING.has(error.code ?? "")) return false;
  if (!warned) console.warn("[email] email_subscriptions is missing: apply migration 0055.");
  warned = true;
  return true;
}

interface Row {
  profile_id: string;
  email: string;
  email_verified_at: string | null;
  daily_email: boolean;
  streak_nudge: boolean;
  last_sent_on: string | null;
  confirm_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "profile_id, email, email_verified_at, daily_email, streak_nudge, last_sent_on, confirm_sent_at, created_at, updated_at";

const fromRow = (r: Row): EmailSub => ({
  profileId: r.profile_id,
  email: r.email,
  verifiedAt: r.email_verified_at,
  dailyEmail: r.daily_email,
  streakNudge: r.streak_nudge,
  lastSentOn: r.last_sent_on,
  confirmSentAt: r.confirm_sent_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRow = (s: EmailSub): Row => ({
  profile_id: s.profileId,
  email: s.email,
  email_verified_at: s.verifiedAt,
  daily_email: s.dailyEmail,
  streak_nudge: s.streakNudge,
  last_sent_on: s.lastSentOn,
  confirm_sent_at: s.confirmSentAt,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
});

const due = (s: EmailSub, today: string) => s.dailyEmail && !!s.verifiedAt && s.lastSentOn !== today;

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), ".data", "pokeiq-email.json");
const g = globalThis as unknown as { __pokeiqEmail?: Record<string, EmailSub> };

function fileDb(): Record<string, EmailSub> {
  if (g.__pokeiqEmail) return g.__pokeiqEmail;
  let db: Record<string, EmailSub> = {};
  try {
    db = JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, EmailSub>;
  } catch {
    // No file yet.
  }
  return (g.__pokeiqEmail = db);
}

function saveFile(): void {
  mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  writeFileSync(tmp, JSON.stringify(fileDb()));
  renameSync(tmp, FILE());
}

const fileStore: EmailStore = {
  async get(id) {
    const s = fileDb()[id];
    return s ? { ...s } : null;
  },
  async save(sub) {
    fileDb()[sub.profileId] = { ...sub };
    saveFile();
  },
  async candidates(today) {
    return Object.values(fileDb())
      .filter((s) => due(s, today))
      .map((s) => ({ ...s }));
  },
  async claim(ids, today) {
    const db = fileDb();
    const got = ids.filter((id) => db[id] && db[id].lastSentOn !== today);
    for (const id of got) db[id].lastSentOn = today;
    if (got.length) saveFile();
    return got;
  },
  async release(ids, today) {
    const db = fileDb();
    for (const id of ids) if (db[id]?.lastSentOn === today) db[id].lastSentOn = null;
    saveFile();
  },
};

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

function supabaseStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): EmailStore {
  const table = () => sb.from("email_subscriptions");
  return {
    async get(id) {
      const { data, error } = await table().select(COLUMNS).eq("profile_id", id).maybeSingle<Row>();
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return data ? fromRow(data) : null;
    },
    async save(sub) {
      const { error } = await table().upsert(toRow(sub));
      if (error) {
        if (missing(error)) throw new EmailUnavailable("email_subscriptions is missing");
        throw new Error(error.message);
      }
    },
    async candidates(today) {
      const out: EmailSub[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await table()
          .select(COLUMNS)
          .eq("daily_email", true)
          .not("email_verified_at", "is", null)
          .or(`last_sent_on.is.null,last_sent_on.neq.${today}`)
          .order("profile_id")
          .range(from, from + PAGE - 1);
        if (error) {
          if (missing(error)) return [];
          throw new Error(error.message);
        }
        out.push(...((data ?? []) as Row[]).map(fromRow));
        if (!data || data.length < PAGE) return out;
      }
    },
    async claim(ids, today) {
      if (!ids.length) return [];
      const { data, error } = await table()
        .update({ last_sent_on: today })
        .in("profile_id", ids)
        .or(`last_sent_on.is.null,last_sent_on.neq.${today}`)
        .select("profile_id");
      if (error) throw new Error(error.message);
      return ((data ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
    },
    async release(ids, today) {
      if (!ids.length) return;
      const { error } = await table().update({ last_sent_on: null }).in("profile_id", ids).eq("last_sent_on", today);
      if (error) throw new Error(error.message);
    },
  };
}

export function emailStore(): EmailStore {
  const sb = getServiceSupabase();
  return sb ? supabaseStore(sb) : fileStore;
}
