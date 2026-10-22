/**
 * Sign in with Discord / Google: what both the server and the browser need.
 * The handshake itself runs server-side (src/lib/server/oauth.ts).
 */

export const OAUTH_PROVIDERS = ["discord", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<OAuthProvider, string> = { discord: "Discord", google: "Google" };

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Providers whose buttons show: NEXT_PUBLIC_OAUTH_PROVIDERS (comma-separated), default both. */
export function enabledOAuthProviders(raw: string | undefined = process.env.NEXT_PUBLIC_OAUTH_PROVIDERS): OAuthProvider[] {
  const list = (raw ?? "discord,google").split(",").map((p) => p.trim().toLowerCase());
  return OAUTH_PROVIDERS.filter((p) => list.includes(p));
}

/** Error codes the callback puts in `?oauth_error=` (never free text, so nothing can be injected). */
export const OAUTH_ERRORS = {
  denied: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was started in another tab — try again.",
  failed: "Couldn't sign you in with that provider right now. Try again, or use your trainer name and password.",
  unavailable: "That sign-in option isn't available right now.",
  banned: "This account is banned.",
  linked_elsewhere: "That account is already linked to a different trainer.",
  already_linked: "You already have an account of that kind linked. Unlink it first.",
  signin_required: "Sign in first, then link the account from your trainer card.",
  rate_limited: "Too many attempts — try again in a minute.",
} as const;
export type OAuthErrorCode = keyof typeof OAUTH_ERRORS;

export function oauthErrorMessage(code: string | null): string | null {
  return code && Object.hasOwn(OAUTH_ERRORS, code) ? OAUTH_ERRORS[code as OAuthErrorCode] : null;
}

/** A connected account as its owner sees it (the email is the owner's own). */
export interface OwnIdentity {
  provider: OAuthProvider;
  email: string | null;
  linkedAt: string;
}
