import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, createUser, toPublicUser } from "@/lib/server/accounts";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_TTL_MS,
  USERNAME_RE,
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  newSessionToken,
  newUserId,
  setSessionCookie,
} from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";

/** POST /api/auth/register — { username, password } -> signed in + one-time recovery code. */

const bodySchema = z.object({
  username: z.string().regex(USERNAME_RE, "Trainer names are 3–20 letters, numbers, _ or -."),
  password: z
    .string()
    .min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, "That password is too long."),
});

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "register", 5);
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    const recoveryCode = generateRecoveryCode();
    const user = await createUser({
      id: newUserId(),
      username: parsed.data.username,
      passwordHash: await hashPassword(parsed.data.password),
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
      createdAt: new Date().toISOString(),
    });
    if (user === "taken") return NextResponse.json({ error: "That trainer name is taken." }, { status: 409 });

    const { token, tokenHash } = newSessionToken();
    await createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    const response = NextResponse.json({ user: toPublicUser(user), recoveryCode }, { status: 201 });
    setSessionCookie(response, token);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
