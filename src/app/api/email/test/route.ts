import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/server/auth";
import { serverError } from "@/lib/server/auth-route";
import { adminFromRequest } from "@/lib/server/moderation";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, emailOff } from "@/lib/server/email/route";
import { atRiskStreak, buildDailyEmail, loadStreakSources, todayUtc } from "@/lib/server/email/daily";
import { sendEmail } from "@/lib/server/email/send";
import { normalizeEmail } from "@/lib/server/email/service";
import { emailStore } from "@/lib/server/email/store";

/**
 * POST { to? } — admins only (POKEIQ_ADMINS): sends today's daily email,
 * marked [Test], to `to` or to the admin's own address on file. Nothing is
 * recorded, so it never counts as today's send.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = emailOff();
  if (off) return off;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403, headers: NO_STORE });
  const admin = await adminFromRequest(request);
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (!rateLimit(`email-test:${admin.id}`, 3, 3 / 60)) return tooManyRequests();
  const body = (await request.json().catch(() => ({}))) as { to?: unknown };
  try {
    const to = body.to ? normalizeEmail(body.to) : ((await emailStore().get(admin.id))?.email ?? null);
    if (!to) return NextResponse.json({ error: body.to ? "That doesn't look like an email address." : "Add your email on your trainer page first, or enter one." }, { status: 400, headers: NO_STORE });
    const today = todayUtc();
    // The admin's own streak line, as their real email would show it.
    const streak = atRiskStreak((await loadStreakSources([admin.id]).catch(() => new Map())).get(admin.id), today);
    const sent = await sendEmail(buildDailyEmail(to, admin.id, admin.username, today, streak, true));
    if (!sent.ok) return NextResponse.json({ error: `Resend said: ${sent.error}` }, { status: 502, headers: NO_STORE });
    return NextResponse.json({ ok: true, to }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
