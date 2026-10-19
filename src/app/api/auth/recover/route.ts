import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  deleteUserSessions,
  findUserByName,
  toPublicUser,
  updateCredentials,
} from "@/lib/server/accounts";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_TTL_MS,
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  newSessionToken,
  sameHash,
  setSessionCookie,
} from "@/lib/server/auth";
import { guardAccount, guardAuthRequest, serverError } from "@/lib/server/auth-route";

/**
 * POST /api/auth/recover — { username, recoveryCode, newPassword }.
 * Resets the password, signs out every other device, and rotates the code
 * (each code works once). Returns the new code to save.
 */

const bodySchema = z.object({
  username: z.string().min(1).max(40),
  recoveryCode: z.string().min(16).max(40),
  newPassword: z
    .string()
    .min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, "That password is too long."),
});

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "recover", 5, 1);
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const slow = guardAccount("recover", parsed.data.username, 5);
  if (slow) return slow;

  try {
    const user = await findUserByName(parsed.data.username.trim());
    if (!user?.recoveryCodeHash || !sameHash(hashRecoveryCode(parsed.data.recoveryCode), user.recoveryCodeHash)) {
      return NextResponse.json({ error: "That trainer name and recovery code don't match." }, { status: 401 });
    }
    const recoveryCode = generateRecoveryCode();
    await updateCredentials(user.id, {
      passwordHash: await hashPassword(parsed.data.newPassword),
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
    });
    await deleteUserSessions(user.id);
    const { token, tokenHash } = newSessionToken();
    await createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    const response = NextResponse.json({ user: toPublicUser(user), recoveryCode });
    setSessionCookie(response, token);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
