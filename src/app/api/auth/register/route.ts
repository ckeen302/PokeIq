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
import { guardSignup, serverError, signupNotMade } from "@/lib/server/auth-route";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { optInAtSignup } from "@/lib/server/email/service";

/**
 * POST /api/auth/register — { username, password, email?, dailyEmail? } ->
 * signed in + one-time recovery code. The optional address (while daily
 * emails are switched on) gets a "Confirm your email" message; it never
 * holds up the sign-up.
 */

const bodySchema = z.object({
  username: z.string().regex(USERNAME_RE, "Trainer names are 3–20 letters, numbers, _ or -.").refine(isCleanName, NAME_REJECTED),
  password: z
    .string()
    .min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, "That password is too long."),
  email: z.string().max(320).nullish(),
  dailyEmail: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  // A household or classroom can sign up together; a script can't mint thousands of accounts.
  const blocked = guardSignup(request, "register");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    signupNotMade(request, "register");
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let made = false;
  try {
    const recoveryCode = generateRecoveryCode();
    const user = await createUser({
      id: newUserId(),
      username: parsed.data.username,
      passwordHash: await hashPassword(parsed.data.password),
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
      createdAt: new Date().toISOString(),
    });
    // Trainer names are public (profiles, leaderboards, the trainer search), so saying one is taken gives nothing away.
    if (user === "taken") {
      signupNotMade(request, "register");
      return NextResponse.json({ error: "That trainer name is taken." }, { status: 409 });
    }
    made = true;

    const { token, tokenHash } = newSessionToken();
    await createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    const email = await optInAtSignup(user, parsed.data);
    const response = NextResponse.json({ user: toPublicUser(user), recoveryCode, ...(email !== "skipped" && { email }) }, { status: 201 });
    setSessionCookie(response, token);
    return response;
  } catch (err) {
    if (!made) signupNotMade(request, "register");
    return serverError(err);
  }
}
