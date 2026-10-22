import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import {
  GEO_HIDE_THRESHOLD,
  groupShotReports,
  hiddenShotIds,
  type GeoReportMode,
  type GeoReportReason,
  type GeoReportStatus,
  type GeoShotReport,
} from "@/lib/geo-reports";
import { setHiddenShots } from "./geo";

/**
 * Reports of bad PokéGuessr screenshots (migration 0025, `geo_shot_reports`):
 * one per reporter per shot. Enough distinct reporters take a shot out of
 * rotation until a moderator keeps it (the reports are cleared) or removes it.
 *
 * Everything here fails open: until the table exists (or without Supabase)
 * a report is logged and thanked, and no shot is hidden, so the game plays
 * on as before. With POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run), and
 * in development without Supabase, reports live in memory.
 */

export type NewShotReport = Pick<GeoShotReport, "shot" | "reason" | "note" | "mode" | "reporter" | "ipHash">;

export interface ShotReportStore {
  /** False: already reported by this reporter. Throws GeoReportsUnavailable before the migration. */
  insert(report: NewShotReport, now: number): Promise<boolean>;
  /** Open and removed reports (what decides the hidden shots). */
  active(): Promise<GeoShotReport[]>;
  list(status: GeoReportStatus | "all", limit: number): Promise<GeoShotReport[]>;
  /** Marks every open report of a shot kept or removed (removed: the shot stays out even with no open reports). */
  review(shot: string, status: Exclude<GeoReportStatus, "open">, by: string, now: number): Promise<number>;
}

export class GeoReportsUnavailable extends Error {}

// ---- memory ------------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqShotReports?: GeoShotReport[] };
const mem = () => (globalStore.__pokeiqShotReports ??= []);
export function clearMemoryShotReports() {
  globalStore.__pokeiqShotReports = [];
  hiddenUntil = 0;
}

export function memoryShotReportStore(): ShotReportStore {
  return {
    async insert(report, now) {
      if (mem().some((r) => r.shot === report.shot && r.reporter === report.reporter)) return false;
      mem().unshift({ ...report, id: (mem()[0]?.id ?? 0) + 1, status: "open", at: now, reviewedAt: null, reviewedBy: null });
      return true;
    },
    async active() {
      return mem().filter((r) => r.status !== "kept");
    },
    async list(status, limit) {
      return mem()
        .filter((r) => status === "all" || r.status === status)
        .slice(0, limit);
    },
    async review(shot, status, by, now) {
      let n = 0;
      for (const r of mem()) {
        if (r.shot !== shot || r.status !== "open") continue;
        Object.assign(r, { status, reviewedAt: now, reviewedBy: by });
        n++;
      }
      return n;
    },
  };
}

// ---- Supabase ------------------------------------------------------------------------

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
let warnedAt = 0;

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[geo-reports] off until migration 0025_geo_shot_reports.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new GeoReportsUnavailable(error.message);
  }
  throw new Error(error.message);
}

interface DbRow {
  id: number;
  shot_id: string;
  reason: GeoReportReason;
  note: string | null;
  mode: GeoReportMode;
  reporter: string;
  ip_hash: string | null;
  status: GeoReportStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
const COLS = "id, shot_id, reason, note, mode, reporter, ip_hash, status, created_at, reviewed_at, reviewed_by";
const fromDb = (r: DbRow): GeoShotReport => ({
  id: Number(r.id),
  shot: r.shot_id,
  reason: r.reason,
  note: r.note,
  mode: r.mode,
  reporter: r.reporter,
  ipHash: r.ip_hash,
  status: r.status,
  at: Date.parse(r.created_at),
  reviewedAt: r.reviewed_at ? Date.parse(r.reviewed_at) : null,
  reviewedBy: r.reviewed_by,
});

export function supabaseShotReportStore(sb: Sb): ShotReportStore {
  const table = () => sb.from("geo_shot_reports");
  return {
    async insert(report, now) {
      const { error } = await table().insert({
        shot_id: report.shot,
        reason: report.reason,
        note: report.note,
        mode: report.mode,
        reporter: report.reporter,
        ip_hash: report.ipHash,
        created_at: new Date(now).toISOString(),
      });
      if (error?.code === "23505") return false;
      check(error);
      return true;
    },
    async active() {
      const { data, error } = await table().select(COLS).in("status", ["open", "removed"]).order("id", { ascending: false }).limit(20_000);
      check(error);
      return ((data ?? []) as DbRow[]).map(fromDb);
    },
    async list(status, limit) {
      let q = table().select(COLS).order("id", { ascending: false }).limit(limit);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      check(error);
      return ((data ?? []) as DbRow[]).map(fromDb);
    },
    async review(shot, status, by, now) {
      const { data, error } = await table()
        .update({ status, reviewed_at: new Date(now).toISOString(), reviewed_by: by })
        .eq("shot_id", shot)
        .eq("status", "open")
        .select("id");
      check(error);
      return (data ?? []).length;
    },
  };
}

export function shotReportStore(): ShotReportStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryShotReportStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseShotReportStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryShotReportStore() : null;
}

// ---------------------------------------------------------------------------
// The hidden shots, kept fresh for the game
// ---------------------------------------------------------------------------

/** How long the hidden shots are trusted before they're read again. */
const HIDDEN_TTL_MS = 60_000;
let hiddenUntil = 0;
let loading: Promise<void> | null = null;

/**
 * Brings the game's hidden shots up to date (at most once a minute). Never
 * throws and never waits long: on any failure the game keeps the set it had
 * (empty at first), so a database problem can't stop anyone playing.
 */
export async function syncHiddenShots(now = Date.now(), store = shotReportStore()): Promise<void> {
  if (!store || now < hiddenUntil) return;
  loading ??= (async () => {
    try {
      setHiddenShots(hiddenShotIds(await store.active()));
    } catch (err) {
      if (!(err instanceof GeoReportsUnavailable)) console.error("[geo-reports] hidden shots not read:", err);
    } finally {
      hiddenUntil = Date.now() + HIDDEN_TTL_MS;
      loading = null;
    }
  })();
  await Promise.race([loading, new Promise((r) => setTimeout(r, 2_000))]);
}

export type ReportOutcome = { ok: true; stored: boolean; hidden: boolean } | { ok: false; status: number; error: string };

/** Saves a player's report. A new report re-reads the hidden shots, so the third one takes the shot out straight away. */
export async function reportShot(report: NewShotReport, now = Date.now(), store = shotReportStore()): Promise<ReportOutcome> {
  const line = `[geo-report] ${report.shot} ${report.reason} (${report.mode})${report.note ? `: ${report.note.slice(0, 200)}` : ""}`;
  if (!store) {
    console.info(line);
    return { ok: true, stored: false, hidden: false };
  }
  try {
    if (!(await store.insert(report, now))) return { ok: false, status: 409, error: "You've already reported this screenshot. Thanks!" };
    const active = await store.active();
    const hidden = hiddenShotIds(active);
    setHiddenShots(hidden);
    hiddenUntil = now + HIDDEN_TTL_MS;
    return { ok: true, stored: true, hidden: hidden.has(report.shot) };
  } catch (err) {
    if (!(err instanceof GeoReportsUnavailable)) console.error("[geo-report] not saved:", err);
    console.info(line);
    return { ok: true, stored: false, hidden: false };
  }
}

/** The review queue: shots with reports in a status, grouped, most-reported first (null: nowhere to read them from). */
export async function shotReviewQueue(status: GeoReportStatus | "all", store = shotReportStore()) {
  if (!store) return null;
  return groupShotReports(await store.list(status, 2_000));
}

/** A moderator's decision: keep the shot (its reports are cleared) or remove it from rotation for good. */
export async function reviewShot(shot: string, decision: "keep" | "remove", by: string, now = Date.now(), store = shotReportStore()): Promise<number> {
  if (!store) return 0;
  const n = await store.review(shot, decision === "keep" ? "kept" : "removed", by, now);
  setHiddenShots(hiddenShotIds(await store.active()));
  hiddenUntil = now + HIDDEN_TTL_MS;
  return n;
}

export { GEO_HIDE_THRESHOLD };
