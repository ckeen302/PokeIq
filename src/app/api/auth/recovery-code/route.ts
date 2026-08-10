/**
 * POST /api/auth/recovery-code — signed-in users mint a fresh recovery code
 * (invalidating any previous one). Covers accounts created before recovery
 * codes existed and players who lost theirs.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  userFromRequest,
} from "@/lib/auth";
import { setRecoveryCode } from "@/lib/auth-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`recovery-code:${clientIp(request)}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many requests — try again in a few minutes" },
      { status: 429 },
    );
  }
  const recoveryCode = generateRecoveryCode();
  await setRecoveryCode(user.id, hashRecoveryCode(recoveryCode));
  return NextResponse.json({ recoveryCode });
}
