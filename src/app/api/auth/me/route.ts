import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled, loadProgress } from "@/lib/server/accounts";
import { SIGNED_IN_HINT_COOKIE, clearSignedInHint, setSignedInHint, userFromRequest } from "@/lib/server/auth";
import { normalizeProgress } from "@/lib/progress-merge";
import { ownAvatar } from "@/lib/server/avatars";
import { emailEnabled } from "@/lib/server/email/config";
import { emailStore } from "@/lib/server/email/store";

/**
 * GET /api/auth/me — the signed-in trainer and their synced progress, plus
 * whether daily reminder emails are switched on (`emailEnabled`) and, for a
 * trainer, whether they're getting them (`dailyEmail`). Keeps the
 * signed-in hint cookie (src/lib/account-hint.ts) in step with the session:
 * set for a trainer, cleared once a session has ended.
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!accountsEnabled()) return NextResponse.json({ enabled: false, user: null, progress: null, emailEnabled: false }, { headers });
  const email = emailEnabled();
  try {
    const user = await userFromRequest(request);
    if (!user) {
      const response = NextResponse.json({ enabled: true, user: null, progress: null, emailEnabled: email }, { headers });
      if (request.cookies.has(SIGNED_IN_HINT_COOKIE)) clearSignedInHint(response);
      return response;
    }
    const [progress, avatar, sub] = await Promise.all([
      loadProgress(user.id).then(normalizeProgress),
      ownAvatar(user),
      email ? emailStore().get(user.id).catch(() => null) : null,
    ]);
    const response = NextResponse.json({ enabled: true, user: { ...user, avatar }, progress, emailEnabled: email, dailyEmail: !!sub?.dailyEmail }, { headers });
    if (request.cookies.get(SIGNED_IN_HINT_COOKIE)?.value !== "1") setSignedInHint(response);
    return response;
  } catch (err) {
    console.error("[accounts]", err);
    return NextResponse.json({ enabled: true, user: null, progress: null, emailEnabled: false, error: "Couldn't reach accounts." }, { headers });
  }
}
