import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type { ReportKind, ReportRow } from "@/lib/moderation";

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
