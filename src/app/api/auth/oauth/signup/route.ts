import { NextRequest, NextResponse } from "next/server";
import { createSession, toPublicUser } from "@/lib/server/accounts";
import { SESSION_TTL_MS, newSessionToken, setSessionCookie } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { SIGNUP_COOKIE, clearOAuthCookie, completeSignup, openSignup, signupSchema } from "@/lib/server/oauth";

/**
 * The "Pick your trainer name" step after a first Discord / Google sign-in.
 * GET  -> { provider, suggestion } for the waiting signup.
 * POST { username, ageConfirmed: true } -> creates the trainer and signs in.
 */

const headers = { "Cache-Control": "no-store" };
const EXPIRED = "That sign-in has expired — start again from the sign-in page.";

export async function GET(request: NextRequest) {
  const pending = openSignup(request.cookies.get(SIGNUP_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: EXPIRED }, { status: 404, headers });
  return NextResponse.json({ provider: pending.p, suggestion: pending.n }, { headers });
}

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "oauth-signup", 8, 1);
  if (blocked) return blocked;
  const pending = openSignup(request.cookies.get(SIGNUP_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: EXPIRED }, { status: 410, headers });
  const parsed = signupSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers });

  try {
    const user = await completeSignup(pending, parsed.data.username);
    if (user === "taken") return NextResponse.json({ error: "That trainer name is taken." }, { status: 409, headers });
    if (user === "exists") {
      const response = NextResponse.json({ error: "That account already has a trainer — sign in again." }, { status: 409, headers });
      clearOAuthCookie(response, SIGNUP_COOKIE);
      return response;
    }
    const { token, tokenHash } = newSessionToken();
    await createSession(tokenHash, user.id, new Date(Date.now() + SESSION_TTL_MS));
    const response = NextResponse.json({ user: toPublicUser(user) }, { status: 201, headers });
    setSessionCookie(response, token);
    clearOAuthCookie(response, SIGNUP_COOKIE);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
