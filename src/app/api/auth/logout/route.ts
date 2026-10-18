import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/server/accounts";
import { clearSessionCookie, sameOrigin, sessionTokenHash } from "@/lib/server/auth";

/** POST /api/auth/logout — ends this device's session. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  const tokenHash = sessionTokenHash(request);
  if (tokenHash) await deleteSession(tokenHash).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
