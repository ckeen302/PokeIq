import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/server/accounts";
import { SESSION_TTL_MS, newSessionToken, setSessionCookie, userFromRequest } from "@/lib/server/auth";
import {
  FLOW_COOKIE,
  SIGNUP_COOKIE,
  SIGNUP_TTL_MS,
  clearOAuthCookie,
  exchangeCode,
  identityFromUser,
  linkIdentity,
  nameTaken,
  oauthCookieOptions,
  resolveSignIn,
  revokeSupabaseSession,
  sanitizeUsername,
  sealSignup,
  supabaseAuthConfig,
  uniqueUsername,
  verifyFlow,
  type Intent,
} from "@/lib/server/oauth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import type { OAuthErrorCode } from "@/lib/oauth";
import { SITE_URL } from "@/lib/site";

/**
 * GET /api/auth/oauth/callback?state=…&code=… — Supabase sends the browser
 * back here. Every redirect goes to a fixed path on SITE_URL (no open
 * redirect); the Supabase tokens never leave the server.
 */

function go(path: string): NextResponse {
  const response = NextResponse.redirect(`${SITE_URL}${path}`, 303);
  response.headers.set("Cache-Control", "no-store");
  clearOAuthCookie(response, FLOW_COOKIE);
  return response;
}

const fail = (code: OAuthErrorCode, intent: Intent = "signin") => go(`${intent === "link" ? "/trainer" : "/login"}?oauth_error=${code}`);

export async function GET(request: NextRequest) {
  if (!rateLimit(`oauth-callback:${clientIp(request)}`, 10, 10 / 60)) return fail("rate_limited");
  const params = request.nextUrl.searchParams;
  const flow = verifyFlow(request.cookies.get(FLOW_COOKIE)?.value, params.get("state"));
  if (!flow) return fail("expired");
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "denied" : "failed", flow.i);
  const code = params.get("code");
  const cfg = supabaseAuthConfig();
  if (!cfg) return fail("unavailable", flow.i);
  if (!code || code.length > 512) return fail("failed", flow.i);

  try {
    const session = await exchangeCode(code, flow.v, cfg);
    if (!session) return fail("failed", flow.i);
    if (session.accessToken) await revokeSupabaseSession(session.accessToken, cfg);
    const identity = identityFromUser(session.user, flow.p);
    if (!identity) return fail("failed", flow.i);

    if (flow.i === "link") {
      const user = await userFromRequest(request);
      if (!user) return fail("signin_required", "link");
      const result = await linkIdentity(user.id, identity);
      return result === "linked" ? go(`/trainer?linked=${flow.p}`) : fail(result, "link");
    }

    const outcome = await resolveSignIn(identity);
    if (outcome.kind === "error") return fail(outcome.code);
    if (outcome.kind === "signed_in") {
      const { token, tokenHash } = newSessionToken();
      await createSession(tokenHash, outcome.profileId, new Date(Date.now() + SESSION_TTL_MS));
      const response = go("/trainer");
      setSessionCookie(response, token);
      return response;
    }
    // A new trainer: pick a name (and confirm 13+) before the account exists.
    const suggestion = await uniqueUsername(sanitizeUsername(identity.displayName), nameTaken);
    const response = go("/login/oauth");
    response.cookies.set(SIGNUP_COOKIE, sealSignup(identity, suggestion), oauthCookieOptions(SIGNUP_TTL_MS, SITE_URL));
    return response;
  } catch (err) {
    console.error("[oauth]", err);
    return fail("failed", flow.i);
  }
}
