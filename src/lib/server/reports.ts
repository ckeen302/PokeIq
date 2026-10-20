import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type { ReportKind, ReportRow } from "@/lib/moderation";
import { maskChat } from "./chat";

/**
 * The `reports` table (0012, with 0020's columns): problem reports and
 * feedback, errors browsers caught, and chat messages players reported.
 * Memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run). Saving
 * never fails a request: without Supabase the report is logged, and before
 * 0020 it's saved the 0012 way (the new fields folded into `extra`).
 */

export type NewReport = Omit<ReportRow, "id" | "createdAt" | "resolvedAt" | "resolvedBy">;

const globalStore = globalThis as unknown as { __pokeiqReports?: ReportRow[] };
export const memoryReports = (): ReportRow[] => (globalStore.__pokeiqReports ??= []);
export function clearMemoryReports() {
  globalStore.__pokeiqReports = [];
}

/** Feedback as it's stored: control characters out, swears masked; null if it's mostly swearing. */
export function cleanFeedback(text: string): string | null {
  const tidy = text.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, (c) => (c === "\n" ? c : " ")).trim();
  if (!tidy) return null;
  const masked = maskChat(tidy);
  return masked.dirty > 0.5 ? null : masked.text;
}

const memory = () => process.env.POKEIQ_LOCAL_ACCOUNTS === "1";

/** Saves a report (see above). */
export async function saveReport(report: NewReport, now = Date.now()): Promise<void> {
  const line = `[report] ${report.kind}${report.category ? `/${report.category}` : ""} on ${report.page ?? "?"}: ${report.message.slice(0, 300)}`;
  if (memory()) {
    const list = memoryReports();
    list.unshift({ id: (list[0]?.id ?? 0) + 1, createdAt: now, resolvedAt: null, resolvedBy: null, ...report });
    list.length = Math.min(list.length, 1000);
    console.info(line);
    return;
  }
  const sb = getServiceSupabase();
  if (!sb) {
    console.info(line);
    return;
  }
  const base = { message: report.message, page: report.page, user_agent: report.userAgent, contact: report.contact };
  try {
    const { error } = await sb.from("reports").insert({ ...base, kind: report.kind, category: report.category, mode: report.mode, reporter: report.reporter, extra: report.extra });
    if (!error) return;
    // Before 0020: no category, mode or reporter columns, and only "error" and "feedback".
    if (error.code === "42703" || error.code === "23514" || error.code === "PGRST204") {
      const legacy = { ...base, kind: (report.kind === "chat" ? "feedback" : report.kind) as Exclude<ReportKind, "chat">, extra: { ...report.extra, kind: report.kind, category: report.category, mode: report.mode, reporter: report.reporter } };
      const retry = await sb.from("reports").insert(legacy);
      if (!retry.error) return;
      console.error(`[report] not saved (${retry.error.code}): ${retry.error.message}. ${line}`);
      return;
    }
    console.error(`[report] not saved (${error.code}): ${error.message}. ${line}`);
  } catch (err) {
    console.error("[report] not saved:", err, line);
  }
}

// ---------------------------------------------------------------------------
// Moderators: reading and resolving
// ---------------------------------------------------------------------------

export interface ReportFilter {
  kind?: ReportKind;
  category?: string;
  mode?: string;
  status?: "open" | "resolved" | "all";
}

type DbRow = {
  id: number;
  created_at: string;
  kind: ReportKind;
  category?: string | null;
  mode?: string | null;
  message: string;
  page: string | null;
  user_agent: string | null;
  contact: string | null;
  extra: Record<string, unknown> | null;
  reporter?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

function fromDb(r: DbRow): ReportRow {
  // Saved before 0020: the new fields were folded into `extra`.
  const x = r.extra ?? {};
  const kind = r.category !== undefined ? r.kind : ((str(x.kind) as ReportKind | null) ?? r.kind);
  return {
    id: Number(r.id),
    createdAt: Date.parse(r.created_at),
    kind: kind === "feedback" && /^Chat report \(/.test(r.message) ? "chat" : kind,
    category: (r.category ?? str(x.category)) as ReportRow["category"],
    mode: r.mode ?? str(x.mode),
    message: r.message,
    page: r.page,
    userAgent: r.user_agent,
    contact: r.contact,
    extra: r.extra,
    reporter: r.reporter ?? str(x.reporter),
    resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : null,
    resolvedBy: r.resolved_by ?? null,
  };
}

function matches(r: ReportRow, f: ReportFilter): boolean {
  if (f.kind && r.kind !== f.kind) return false;
  if (f.category && r.category !== f.category) return false;
  if (f.mode && r.mode !== f.mode) return false;
  if (f.status === "open" && r.resolvedAt) return false;
  if (f.status === "resolved" && !r.resolvedAt) return false;
  return true;
}

/** The latest reports matching `f` (null: nowhere to read them from). */
export async function listReports(f: ReportFilter, limit = 100): Promise<ReportRow[] | null> {
  if (memory()) return memoryReports().filter((r) => matches(r, f)).slice(0, limit);
  const sb = getServiceSupabase();
  if (!sb) return null;
  let q = sb.from("reports").select("*").order("id", { ascending: false });
  if (f.kind) q = q.eq("kind", f.kind);
  if (f.category) q = q.eq("category", f.category);
  if (f.mode) q = q.eq("mode", f.mode);
  if (f.status === "open") q = q.is("resolved_at", null);
  if (f.status === "resolved") q = q.not("resolved_at", "is", null);
  const { data, error } = await q.limit(limit);
  if (!error) return ((data ?? []) as DbRow[]).map(fromDb);
  // Before 0020 (no such columns): read the latest and filter here.
  const legacy = await sb.from("reports").select("*").order("id", { ascending: false }).limit(500);
  if (legacy.error) throw new Error(legacy.error.message);
  return ((legacy.data ?? []) as DbRow[]).map(fromDb).filter((r) => matches(r, f)).slice(0, limit);
}

/** Marks a report resolved (or open again). False if it doesn't exist or can't be marked yet (before 0020). */
export async function resolveReport(id: number, by: string, resolved: boolean, now = Date.now()): Promise<boolean> {
  if (memory()) {
    const r = memoryReports().find((x) => x.id === id);
    if (!r) return false;
    r.resolvedAt = resolved ? now : null;
    r.resolvedBy = resolved ? by : null;
    return true;
  }
  const sb = getServiceSupabase();
  if (!sb) return false;
  const { data, error } = await sb
    .from("reports")
    .update({ resolved_at: resolved ? new Date(now).toISOString() : null, resolved_by: resolved ? by : null })
    .eq("id", id)
    .select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}
