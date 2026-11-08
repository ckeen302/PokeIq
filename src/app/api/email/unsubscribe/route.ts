import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, emailOff } from "@/lib/server/email/route";
import { unsubscribeByToken } from "@/lib/server/email/service";

/**
 * POST ?token=… — one-click unsubscribe (RFC 8058: mail apps POST
 * "List-Unsubscribe=One-Click" to the List-Unsubscribe URL), and the
 * /email/unsubscribe page's call (token in the query or a JSON body).
 * Works while email is switched off too, so an old link never fails.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!rateLimit(`email-unsub:${clientIp(request)}`, 20, 20 / 60)) return tooManyRequests();
  let token: unknown = request.nextUrl.searchParams.get("token");
  if (!token && request.headers.get("content-type")?.includes("application/json")) {
    token = ((await request.json().catch(() => ({}))) as { token?: unknown }).token;
  }
  try {
    const ok = await unsubscribeByToken(token);
    return NextResponse.json(ok ? { ok: true } : { error: "That unsubscribe link isn't valid." }, { status: ok ? 200 : 400, headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

/** A plain visit to the header's URL: send it to the page that does the unsubscribing. */
export async function GET(request: NextRequest) {
  const off = emailOff();
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (off && !token) return off;
  return NextResponse.redirect(new URL(`/email/unsubscribe?token=${encodeURIComponent(token)}`, request.url), 303);
}
