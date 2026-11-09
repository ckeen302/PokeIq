import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, emailOff } from "@/lib/server/email/route";
import { confirmByToken } from "@/lib/server/email/service";

/**
 * POST { token } — the double opt-in. The /email/confirm page posts it from
 * the browser, so a mail scanner fetching the link confirms nothing.
 * -> { status: "confirmed" | "invalid" | "stale" }
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = emailOff();
  if (off) return off;
  if (!rateLimit(`email-confirm:${clientIp(request)}`, 10, 10 / 60)) return tooManyRequests();
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  try {
    const status = await confirmByToken(body.token);
    return NextResponse.json({ status }, { status: status === "confirmed" ? 200 : 400, headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
