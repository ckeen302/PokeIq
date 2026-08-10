/** POST /api/auth/register — create an account and sign in immediately. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_TTL_MS,
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  newSessionToken,
  newUserId,
  setSessionCookie,
} from "@/lib/auth";
import { createSession, createUser, findUserByUsername } from "@/lib/auth-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  username: z
    .string()
    .regex(
      /^[a-zA-Z0-9_]{3,20}$/,
      "3–20 characters: letters, numbers, underscores",
    ),
  password: z.string().min(8, "At least 8 characters").max(100),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`register:${clientIp(request)}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many signups — try again in a few minutes" },
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
  const { username, password } = parsed.data;
  if (await findUserByUsername(username)) {
    return NextResponse.json(
      { error: "That trainer name is taken" },
      { status: 409 },
    );
  }
  // One-time recovery code: shown once at signup, only its hash is stored.
  const recoveryCode = generateRecoveryCode();
  const user = {
    id: newUserId(),
    username,
    usernameLower: username.toLowerCase(),
    passwordHash: hashPassword(password),
    recoveryCodeHash: hashRecoveryCode(recoveryCode),
    createdAt: new Date().toISOString(),
  };
  if (!(await createUser(user))) {
    return NextResponse.json(
      { error: "That trainer name is taken" },
      { status: 409 },
    );
  }
  const { token, tokenHash } = newSessionToken();
  await createSession({
    tokenHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  const response = NextResponse.json(
    { user: { id: user.id, username: user.username }, recoveryCode },
    { status: 201 },
  );
  setSessionCookie(response, token);
  return response;
}
