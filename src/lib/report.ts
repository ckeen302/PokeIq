/**
 * Problem reports, from the browser: what a player writes in "Report a
 * problem", and errors the page didn't catch. Both go to POST /api/report.
 *
 * Errors are sent at most five per page load, each one once per visit, and
 * the noise every site sees is skipped: browser extensions, ResizeObserver
 * warnings, dropped connections and stale chunks after a deploy.
 */

export const REPORT_MESSAGE_MAX = 2000;
export const REPORT_CONTACT_MAX = 200;
export const REPORT_PAGE_MAX = 500;
/** The whole request body. */
export const REPORT_BODY_MAX = 16_000;
/** `extra`, as JSON. */
export const REPORT_EXTRA_MAX = 6_000;

export type ReportKind = "error" | "feedback";

export interface ReportBody {
  kind: ReportKind;
  message: string;
  page?: string;
  contact?: string;
  extra?: Record<string, unknown>;
}

const MAX_ERRORS_PER_PAGE = 5;
const SEEN_KEY = "pokeiq:reported-errors";

const NOISE = [
  /ResizeObserver loop/i,
  /^(uncaught )?script error\.?$/i,
  /failed to fetch|load failed|networkerror|network error|network request failed/i,
  /loading (css )?chunk .* failed|chunkloaderror|failed to load chunk/i,
  /aborterror|the (user|operation) (was )?aborted|signal is aborted/i,
  /chrome-extension:|moz-extension:|safari(-web)?-extension:|webkit-masked-url/i,
];

let errorsSent = 0;
const seenThisPage = new Set<string>();

/** The page this report is about: path and query, without the origin. */
export function currentPage(): string {
  return typeof location === "undefined" ? "" : `${location.pathname}${location.search}`.slice(0, REPORT_PAGE_MAX);
}

/** Sends a report; the error message to show if it didn't go through. */
export async function sendReport(body: ReportBody, opts: { keepalive?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, page: body.page ?? currentPage() }),
      keepalive: opts.keepalive,
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "Couldn't send that. Try again in a moment." };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Whether this visit has reported `key` already (kept for the tab's session, so a reload loop sends it once). */
function alreadySeen(key: string): boolean {
  if (seenThisPage.has(key)) return true;
  seenThisPage.add(key);
  try {
    const seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[];
    if (seen.includes(key)) return true;
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen, key].slice(-30)));
  } catch {
    // Storage blocked: this page load's memory is enough.
  }
  return false;
}

/** Reports an error the page didn't handle (or an error boundary caught). Never throws. */
export function reportError(error: unknown, extra: Record<string, unknown> = {}): void {
  try {
    if (typeof window === "undefined" || errorsSent >= MAX_ERRORS_PER_PAGE) return;
    const err = error instanceof Error ? error : null;
    const message = (err ? `${err.name}: ${err.message}` : String(error ?? "Unknown error")).slice(0, REPORT_MESSAGE_MAX);
    const stack = (err?.stack ?? "").slice(0, 3000);
    if (NOISE.some((re) => re.test(message) || re.test(stack))) return;
    const key = `${message.slice(0, 200)}|${stack.split("\n")[1]?.trim() ?? ""}`;
    if (alreadySeen(key)) return;
    errorsSent++;
    void sendReport({ kind: "error", message, extra: { ...extra, stack: stack || undefined } }, { keepalive: true });
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

/** Reports uncaught errors and unhandled promise rejections; returns the cleanup. */
export function installErrorReporter(): () => void {
  const onError = (event: ErrorEvent) => {
    // Scripts from elsewhere (extensions, injected widgets) aren't ours to fix.
    if (event.filename && !event.filename.startsWith(location.origin)) return;
    reportError(event.error ?? event.message, { source: "window", file: event.filename || undefined, line: event.lineno || undefined, col: event.colno || undefined });
  };
  const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason, { source: "promise" });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
