import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { sameOrigin } from "@/lib/server/auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { REPORT_BODY_MAX, REPORT_CONTACT_MAX, REPORT_EXTRA_MAX, REPORT_MESSAGE_MAX, REPORT_PAGE_MAX } from "@/lib/report";

/**
 * POST /api/report — { kind: "feedback" | "error", message, page?, contact?, extra? }
 *
 * "Report a problem" and the browser's error reporter write here; the rows
 * land in `reports` (migration 0012), read in the Supabase dashboard. A
 * report is never worth a 500: without Supabase, or before the table exists,
 * it's logged and the player still hears "thanks".
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  kind: z.enum(["error", "feedback"]),
  message: z.string().trim().min(1, "Tell us what went wrong.").max(REPORT_MESSAGE_MAX, "That's a bit long: keep it under 2,000 characters."),
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

  // A person writes a few; a broken page sends at most five errors per load. Errors don't use up the feedback allowance.
  const ip = clientIp(request);
  const allowed =
    report.kind === "feedback" ? rateLimit(`report-feedback:${ip}`, 5, 1 / 60) : rateLimit(`report-error:${ip}`, 10, 1 / 30);
  if (!allowed) return tooManyRequests("You've sent a lot of reports. Try again in a few minutes.", 120);
  // Every report on this instance: a bug on every page can't flood the table.
  if (!rateLimit("report-all", 200, 2)) return tooManyRequests("Lots of reports right now. Try again in a few minutes.", 120);

  const row = {
    kind: report.kind,
    message: report.message,
    page: report.page || null,
    user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    contact: report.contact || null,
    extra: report.extra ?? null,
  };
  const supabase = getServiceSupabase();
  if (!supabase) {
    console.info(`[report] ${row.kind} on ${row.page ?? "?"}: ${row.message.slice(0, 300)}`);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }
  try {
    const { error } = await supabase.from("reports").insert(row);
    if (error) console.error(`[report] not saved (${error.code}): ${error.message}. ${row.kind} on ${row.page ?? "?"}: ${row.message.slice(0, 300)}`);
  } catch (err) {
    console.error("[report] not saved:", err);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
