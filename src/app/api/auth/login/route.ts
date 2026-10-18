import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, findUserByName, toPublicUser } from "@/lib/server/accounts";
import {
  PASSWORD_MAX,
  SESSION_TTL_MS,
  burnPasswordCheck,
  newSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";

/** POST /api/auth/login — { username, password } -> session cookie. */

const bodySchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "login");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter your trainer name and password." }, { status: 400 });

  try {
    const user = await findUserByName(parsed.data.username.trim());
    const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : (await burnPasswordCheck(parsed.data.password), false);
    if (!user || !valid) {
      return NextResponse.json({ error: "Wrong trainer name or password." }, { status: 401 });
    }
    const { token, tokenHash } = newSessionToken();
    await createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    const response = NextResponse.json({ user: toPublicUser(user) });
    setSessionCookie(response, token);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
