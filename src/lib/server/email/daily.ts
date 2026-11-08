import "server-only";
import { createHash } from "node:crypto";
import { dailyNumber, previousDate } from "@/lib/daily";
import { getServiceSupabase } from "@/lib/supabase";
import { loadProgress, usersByIds } from "../accounts";
import { emailSiteUrl, postalAddress } from "./config";
import { RESEND_BATCH_MAX, sendBatch, type SendResult } from "./send";
import { emailStore, type EmailStore, type EmailSub } from "./store";
import { dailyEmail, type AtRiskStreak, type Message, type StreakGame } from "./templates";
import { unsubscribeToken } from "./tokens";

/**
 * The daily email job (the Vercel cron at the daily reset): every confirmed,
 * opted-in trainer not yet mailed today gets today's email; a trainer who
 * asked for "streak at risk only" gets it only on a day a daily streak is
 * live and today's puzzle isn't done yet. Rows are claimed (last_sent_on =
 * today) before each batch is sent, so a re-run never mails anyone twice;
 * a batch Resend refuses is released again and the run stops there.
 */

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/** One daily's stored streak: the last day finished and the streak then. Untrusted shapes. */
export type StreakSource = Partial<Record<StreakGame, { last: unknown; streak: unknown }>>;

/**
 * The longest streak that ends tonight: finished yesterday, not yet today
 * (a streak finished today is safe, an older one is already broken).
 */
export function atRiskStreak(src: StreakSource | undefined, today: string): AtRiskStreak | null {
  if (!src) return null;
  const yesterday = previousDate(today);
  let best: AtRiskStreak | null = null;
  for (const game of Object.keys(src) as StreakGame[]) {
    const s = src[game];
    if (!s || s.last !== yesterday || typeof s.streak !== "number" || !Number.isInteger(s.streak) || s.streak < 1) continue;
    if (!best || s.streak > best.days) best = { game, days: s.streak };
  }
  return best;
}

/** The streak fields of a synced progress object (lib/progress.ts). */
export function streakSourceOf(progress: unknown): StreakSource {
  const p = (progress ?? {}) as Record<string, unknown>;
  const block = (v: unknown) => {
    const b = v as { last?: unknown; streak?: unknown } | null | undefined;
    return b && typeof b === "object" ? { last: b.last, streak: b.streak } : undefined;
  };
  const best = (p.best ?? {}) as Record<string, unknown>;
  // PokéGuessr keeps its daily streak in the numeric `best` map, the last day as YYYYMMDD.
  const geoLastN = best["geo:dailyLast"];
  const geoLast = typeof geoLastN === "number" ? String(geoLastN).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : null;
  return {
    daily: block(p.daily),
    dle: block(p.dle),
    conn: block(p.conn),
    pdk: block(p.pdk),
    geo: geoLast ? { last: geoLast, streak: best["geo:dailyStreak"] } : undefined,
  };
}

/** Streak sources for these trainers, read from their synced progress. */
export async function loadStreakSources(ids: string[]): Promise<Map<string, StreakSource>> {
  const out = new Map<string, StreakSource>();
  const sb = getServiceSupabase();
  if (!sb) {
    for (const id of ids) out.set(id, streakSourceOf(await loadProgress(id).catch(() => null)));
    return out;
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from("user_progress")
      .select(
        "user_id, dailyLast:progress->daily->last, dailyStreak:progress->daily->streak, dleLast:progress->dle->last, dleStreak:progress->dle->streak, connLast:progress->conn->last, connStreak:progress->conn->streak, pdkLast:progress->pdk->last, pdkStreak:progress->pdk->streak, best:progress->best"
      )
      .in("user_id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    type Row = Record<string, unknown> & { user_id: string };
    for (const r of (data ?? []) as unknown as Row[]) {
      const src = streakSourceOf({
        daily: { last: r.dailyLast, streak: r.dailyStreak },
        dle: { last: r.dleLast, streak: r.dleStreak },
        conn: { last: r.connLast, streak: r.connStreak },
        pdk: { last: r.pdkLast, streak: r.pdkStreak },
        best: r.best,
      });
      out.set(r.user_id, src);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Who gets today's email
// ---------------------------------------------------------------------------

export interface Recipient {
  sub: EmailSub;
  streak: AtRiskStreak | null;
}

export function pickRecipients(candidates: EmailSub[], streaks: Map<string, StreakSource>, today: string): Recipient[] {
  const out: Recipient[] = [];
  for (const sub of candidates) {
    if (!sub.dailyEmail || !sub.verifiedAt || sub.lastSentOn === today) continue;
    const streak = atRiskStreak(streaks.get(sub.profileId), today);
    if (sub.streakNudge && !streak) continue;
    out.push({ sub, streak });
  }
  return out;
}

/** The email for one trainer (also the admin's test email). */
export function buildDailyEmail(to: string, profileId: string, username: string, date: string, streak: AtRiskStreak | null, test = false): Message {
  const site = emailSiteUrl();
  return dailyEmail({
    to,
    username,
    date,
    dailyNumber: dailyNumber(date),
    siteUrl: site,
    imageUrl: `${site}/api/email/daily-image?date=${date}`,
    unsubscribeUrl: `${site}/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(profileId))}`,
    settingsUrl: `${site}/trainer#settings`,
    postalAddress: postalAddress(),
    streak,
    test,
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface DailyDeps {
  store: EmailStore;
  usernames(ids: string[]): Promise<Map<string, string>>;
  streaks(ids: string[], today: string): Promise<Map<string, StreakSource>>;
  send(messages: Message[], idempotencyKey: string): Promise<SendResult>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const defaultDailyDeps = (): DailyDeps => ({
  store: emailStore(),
  usernames: async (ids) => new Map((await usersByIds(ids)).map((u) => [u.id, u.username])),
  streaks: (ids) => loadStreakSources(ids),
  send: (messages, key) => sendBatch(messages, { idempotencyKey: key }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
});

export interface DailyRunResult {
  date: string;
  candidates: number;
  eligible: number;
  sent: number;
  /** Set when a batch failed: the run stopped there and the batch was released. */
  error?: string;
  /** Stopped early to stay inside the function's time limit; the rest wait for a re-run today. */
  incomplete?: boolean;
}

/** Resend allows a couple of requests a second by default. */
const BATCH_GAP_MS = 600;

export async function runDailyEmail(date: string, deps: DailyDeps = defaultDailyDeps(), opts: { batchSize?: number; budgetMs?: number } = {}): Promise<DailyRunResult> {
  const started = deps.now();
  const batchSize = Math.min(opts.batchSize ?? RESEND_BATCH_MAX, RESEND_BATCH_MAX);
  const budget = opts.budgetMs ?? 50_000;
  const candidates = await deps.store.candidates(date);
  if (!candidates.length) return { date, candidates: 0, eligible: 0, sent: 0 };
  const ids = candidates.map((c) => c.profileId);
  const [streaks, names] = await Promise.all([deps.streaks(ids, date), deps.usernames(ids)]);
  // A trainer whose account is gone is left out.
  const recipients = pickRecipients(candidates, streaks, date).filter((r) => names.has(r.sub.profileId));
  const result: DailyRunResult = { date, candidates: candidates.length, eligible: recipients.length, sent: 0 };

  for (let i = 0; i < recipients.length; i += batchSize) {
    if (deps.now() - started > budget) {
      result.incomplete = true;
      break;
    }
    if (i > 0) await deps.sleep(BATCH_GAP_MS);
    const chunk = recipients.slice(i, i + batchSize);
    const claimed = new Set(await deps.store.claim(chunk.map((r) => r.sub.profileId), date));
    const batch = chunk.filter((r) => claimed.has(r.sub.profileId));
    if (!batch.length) continue;
    const messages = batch.map((r) => buildDailyEmail(r.sub.email, r.sub.profileId, names.get(r.sub.profileId)!, date, r.streak));
    const key = `daily-email/${date}/${createHash("sha256").update(batch.map((r) => r.sub.profileId).join(",")).digest("hex").slice(0, 32)}`;
    const sent = await deps.send(messages, key);
    if (!sent.ok) {
      await deps.store.release(batch.map((r) => r.sub.profileId), date).catch(() => undefined);
      result.error = `Resend ${sent.status || "network"}: ${sent.error}`;
      console.error("[email] daily batch failed, stopping:", result.error);
      break;
    }
    result.sent += batch.length;
  }
  return result;
}
