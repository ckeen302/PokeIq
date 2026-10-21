import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled, loadProgress } from "@/lib/server/accounts";
import { userFromRequest } from "@/lib/server/auth";
import { normalizeProgress } from "@/lib/progress-merge";
import { ownAvatar } from "@/lib/server/avatars";

/** GET /api/auth/me — the signed-in trainer and their synced progress. */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!accountsEnabled()) return NextResponse.json({ enabled: false, user: null, progress: null }, { headers });
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ enabled: true, user: null, progress: null }, { headers });
    const [progress, avatar] = await Promise.all([loadProgress(user.id).then(normalizeProgress), ownAvatar(user)]);
    return NextResponse.json({ enabled: true, user: { ...user, avatar }, progress }, { headers });
  } catch (err) {
    console.error("[accounts]", err);
    return NextResponse.json({ enabled: true, user: null, progress: null, error: "Couldn't reach accounts." }, { headers });
  }
}
