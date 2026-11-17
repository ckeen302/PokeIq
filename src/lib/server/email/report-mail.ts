import "server-only";
import { claimOnce } from "@/lib/server/replay-guard";
import { emailEnabled } from "./config";
import { sendEmail } from "./send";
import type { Message } from "./templates";

/**
 * Tells the owner by email when a player sends feedback or reports a chat
 * message ("Report a problem" and chat's "Report"). The report itself is
 * always saved first (reports.ts); this is only the nudge, so it never
 * fails a request. Browser errors don't send one: there are too many.
 *
 * Needs the same Resend setup as the daily emails (docs/email.md). At most
 * REPORT_MAILS_PER_WINDOW emails per 6 hours, however many reports arrive:
 * past that the reports still land on the admin page, but a flood of them
 * can't use up the Resend allowance the daily emails need.
 */

const DEFAULT_TO = "pokeiq.official@gmail.com";
export const REPORT_MAILS_PER_WINDOW = 10;
const WINDOW_MS = 6 * 60 * 60 * 1000;

export interface ReportMailInput {
  kind: "feedback" | "error" | "chat";
  category?: string | null;
  mode?: string | null;
  message: string;
  page?: string | null;
  contact?: string | null;
  reporter?: string | null;
  userAgent?: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reportRecipient(): string {
  return process.env.REPORT_EMAIL_TO?.trim() || DEFAULT_TO;
}

/** The email for one report. */
export function reportMessage(r: ReportMailInput, to = reportRecipient()): Message {
  const label = r.kind === "chat" ? "Reported chat message" : r.category === "bug" ? "Bug report" : r.category === "idea" ? "Idea" : "Feedback";
  const subject = `[PokéIQ] ${label}: ${r.message.replace(/\s+/g, " ").trim().slice(0, 70)}`;
  const lines = [
    `${label}${r.mode ? ` (${r.mode})` : ""}`,
    `Page: ${r.page || "?"}`,
    `From: ${r.reporter ?? "a guest"}${r.contact ? `, contact: ${r.contact}` : ""}`,
    r.userAgent ? `Browser: ${r.userAgent}` : null,
    "",
    r.message,
    "",
    "All reports: https://playpokeiq.com/admin",
  ].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  return { to, subject, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre>` };
}

/** Sends the nudge if email is set up and this 6-hour window has room. Returns whether it was sent. */
export async function notifyReport(r: ReportMailInput, now = Date.now()): Promise<boolean> {
  if (r.kind === "error" || !emailEnabled()) return false;
  try {
    const window = Math.floor(now / WINDOW_MS);
    let slot = -1;
    for (let i = 0; i < REPORT_MAILS_PER_WINDOW; i++) {
      if (await claimOnce(`report-mail:${window}:${i}`)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return false;
    const res = await sendEmail(reportMessage(r), { idempotencyKey: `report-mail:${window}:${slot}:${r.message.length}:${r.page ?? ""}`.slice(0, 200) });
    if (!res.ok) console.error(`[report] email not sent (${res.status}): ${res.error}`);
    return res.ok;
  } catch (err) {
    console.error("[report] email failed:", err);
    return false;
  }
}
