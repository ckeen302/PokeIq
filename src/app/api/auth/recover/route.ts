/**
 * POST /api/auth/recover — account recovery via one-time recovery code.
 *
 * The code alone identifies the account (so it also recovers a forgotten
 * username). On success: password is reset, the used code is rotated for a
 * fresh one, every existing session is revoked, and a new session starts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_TTL_MS,
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  newSessionToken,
  setSessionCookie,
} from "@/lib/auth";
import {
  createSession,
  deleteSessionsForUser,
  findUserByRecoveryHash,
  resetCredentials,
} from "@/lib/auth-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  recoveryCode: z.string().min(10).max(40),
  newPassword: z.string().min(8, "At least 8 characters").max(100),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`recover:${clientIp(request)}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a few minutes" },
      { status: 429 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const user = await findUserByRecoveryHash(
    hashRecoveryCode(parsed.data.recoveryCode),
  );
  if (!user) {
    return NextResponse.json(
      { error: "That recovery code doesn't match any account" },
      { status: 401 },
    );
  }

  // Rotate credentials: new password, fresh one-time code, all sessions out.
  const nextRecoveryCode = generateRecoveryCode();
  await resetCredentials(
    user.id,
    hashPassword(parsed.data.newPassword),
    hashRecoveryCode(nextRecoveryCode),
  );
  await deleteSessionsForUser(user.id);

  const { token, tokenHash } = newSessionToken();
  await createSession({
    tokenHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  const response = NextResponse.json({
    user: { id: user.id, username: user.username },
    recoveryCode: nextRecoveryCode,
  });
  setSessionCookie(response, token);
  return response;
}
