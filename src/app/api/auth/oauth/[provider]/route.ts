import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled } from "@/lib/server/accounts";
import { userFromRequest } from "@/lib/server/auth";
import { FLOW_COOKIE, FLOW_TTL_MS, oauthCookieOptions, startFlow, supabaseAuthConfig } from "@/lib/server/oauth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { enabledOAuthProviders, isOAuthProvider, type OAuthErrorCode } from "@/lib/oauth";
import { SITE_URL } from "@/lib/site";

/**
 * GET /api/auth/oauth/discord|google[?intent=link] — starts "Continue with …":
 * seals a PKCE verifier + state in a 10-minute cookie and redirects to
 * Supabase Auth. `intent=link` adds the account to the signed-in trainer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const intent = request.nextUrl.searchParams.get("intent") === "link" ? "link" : "signin";
  const back = (code: OAuthErrorCode) =>
    NextResponse.redirect(`${SITE_URL}${intent === "link" ? "/trainer" : "/login"}?oauth_error=${code}`, 303);

  if (!isOAuthProvider(provider) || !enabledOAuthProviders().includes(provider)) return back("unavailable");
  if (!rateLimit(`oauth-start:${clientIp(request)}`, 20, 20 / 60)) return back("rate_limited");
  const cfg = supabaseAuthConfig();
  if (!cfg || !accountsEnabled()) return back("unavailable");

  // The callback lands on SITE_URL, so the flow cookie must be set on that host too.
  if (request.nextUrl.host !== new URL(SITE_URL).host) {
    return NextResponse.redirect(`${SITE_URL}/api/auth/oauth/${provider}${intent === "link" ? "?intent=link" : ""}`, 303);
  }
  if (intent === "link" && !(await userFromRequest(request).catch(() => null))) return back("signin_required");

  const { cookie, authorizeUrl } = startFlow(provider, intent, { siteUrl: SITE_URL, supabaseUrl: cfg.url });
  const response = NextResponse.redirect(authorizeUrl, 303);
  response.cookies.set(FLOW_COOKIE, cookie, oauthCookieOptions(FLOW_TTL_MS, SITE_URL));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
