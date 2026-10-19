import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/server/accounts";
import { clearSessionCookie, sameOrigin, sessionTokenHash } from "@/lib/server/auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/** POST /api/auth/logout — ends this device's session. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  if (!rateLimit(`logout:${clientIp(request)}`, 20, 1)) return tooManyRequests();
  const tokenHash = sessionTokenHash(request);
  if (tokenHash) await deleteSession(tokenHash).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
