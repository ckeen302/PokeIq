import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled, loadProgress } from "@/lib/server/accounts";
import { userFromRequest } from "@/lib/server/auth";
import { normalizeProgress } from "@/lib/progress-merge";
import { ownAvatar } from "@/lib/server/avatars";
import { emailEnabled } from "@/lib/server/email/config";
import { emailStore } from "@/lib/server/email/store";

/**
 * GET /api/auth/me — the signed-in trainer and their synced progress, plus
 * whether daily reminder emails are switched on (`emailEnabled`) and, for a
 * trainer, whether they're getting them (`dailyEmail`).
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!accountsEnabled()) return NextResponse.json({ enabled: false, user: null, progress: null, emailEnabled: false }, { headers });
  const email = emailEnabled();
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ enabled: true, user: null, progress: null, emailEnabled: email }, { headers });
    const [progress, avatar, sub] = await Promise.all([
      loadProgress(user.id).then(normalizeProgress),
      ownAvatar(user),
      email ? emailStore().get(user.id).catch(() => null) : null,
    ]);
    return NextResponse.json({ enabled: true, user: { ...user, avatar }, progress, emailEnabled: email, dailyEmail: !!sub?.dailyEmail }, { headers });
  } catch (err) {
    console.error("[accounts]", err);
    return NextResponse.json({ enabled: true, user: null, progress: null, emailEnabled: false, error: "Couldn't reach accounts." }, { headers });
  }
}
