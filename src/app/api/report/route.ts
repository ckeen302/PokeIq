import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { maskChat } from "@/lib/server/chat";
import { cleanFeedback, saveReport } from "@/lib/server/reports";
import { REPORT_BODY_MAX, REPORT_CONTACT_MAX, REPORT_EXTRA_MAX, REPORT_MESSAGE_MAX, REPORT_PAGE_MAX } from "@/lib/report";
import { FEEDBACK_CATEGORIES, FEEDBACK_MODES, type FeedbackMode } from "@/lib/moderation";

/**
 * POST /api/report — { kind: "feedback" | "error" | "chat", message, category?, mode?, page?, contact?, extra? }
 *
 * The feedback form (ideas, bugs, anything else; a bug carries the page,
 * the browser and the page's recent errors), the browser's error reporter
 * and chat's "Report" write here; the rows land in `reports` (0012 and
 * 0020), read on the admin page. Feedback is checked like chat: swears
 * masked, a message that's mostly swearing refused. A report is never worth
 * a 500: without Supabase, or before the table exists, it's logged and the
 * player still hears "thanks".
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  kind: z.enum(["error", "feedback", "chat"]),
  message: z.string().trim().min(1, "Tell us what went wrong.").max(REPORT_MESSAGE_MAX, "That's a bit long: keep it under 2,000 characters."),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  mode: z.enum(Object.keys(FEEDBACK_MODES) as [FeedbackMode, ...FeedbackMode[]]).optional(),
  page: z.string().trim().max(REPORT_PAGE_MAX).optional(),
  contact: z.string().trim().max(REPORT_CONTACT_MAX, "That contact is too long.").optional(),
  extra: z
    .record(z.string(), z.unknown())
    .refine((extra) => JSON.stringify(extra).length <= REPORT_EXTRA_MAX, "Too much detail.")
    .optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });

  const tooBig = NextResponse.json({ error: "That report is too long." }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > REPORT_BODY_MAX) return tooBig;
  const text = await request.text().catch(() => "");
  if (text.length > REPORT_BODY_MAX) return tooBig;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "That report didn't come through. Try again." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const report = parsed.data;

  let message = report.message;
  let contact = report.contact || null;
  if (report.kind === "feedback") {
    const cleaned = cleanFeedback(message);
    if (!cleaned) return NextResponse.json({ error: "Keep it friendly: that wasn't sent." }, { status: 400 });
    message = cleaned;
    if (contact) contact = maskChat(contact).text;
  }

  // A person writes a few; a broken page sends at most five errors per load. Errors don't use up the feedback allowance.
  const ip = clientIp(request);
  const allowed =
    report.kind === "error" ? rateLimit(`report-error:${ip}`, 10, 1 / 30) : report.kind === "chat" ? rateLimit(`report-chat:${ip}`, 10, 1 / 60) : rateLimit(`report-feedback:${ip}`, 5, 1 / 60);
  if (!allowed) return tooManyRequests("You've sent a lot of reports. Try again in a few minutes.", 120);
  // Every report on this instance: a bug on every page can't flood the table.
  if (!rateLimit("report-all", 200, 2)) return tooManyRequests("Lots of reports right now. Try again in a few minutes.", 120);

  const reporter = report.kind !== "error" && sessionTokenHash(request) ? ((await userFromRequest(request).catch(() => null))?.username ?? null) : null;
  await saveReport({
    kind: report.kind,
    category: report.kind === "feedback" ? (report.category ?? "other") : null,
    mode: report.mode ?? null,
    message,
    page: report.page || null,
    userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    contact,
    extra: report.extra ?? null,
    reporter,
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
