/**
 * Whether the browser needs to ask the server who it is (GET /api/auth/me) on
 * a page load. Every visitor used to ask on every page: one serverless call
 * per page view, most of them from visitors who have never signed in.
 *
 * - The server sets SIGNED_IN_HINT_COOKIE ("1", readable by the page's script)
 *   with the session cookie and clears it with it (src/lib/server/auth.ts).
 *   With it, the page asks, as before.
 * - Without it, the page asks only when the site-wide answers it keeps (are
 *   accounts and daily emails switched on) are missing or older than
 *   SITE_FLAGS_MAX_AGE_MS. That also covers a session from before the hint
 *   existed: its first ask sets the hint.
 */

export const SIGNED_IN_HINT_COOKIE = "pokeiq_signed_in";
export const SITE_FLAGS_KEY = "pokeiq:account-flags";
export const SITE_FLAGS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface SiteFlags {
  enabled: boolean;
  emailEnabled: boolean;
  at: number;
}

export function hasSignedInHint(cookie: string): boolean {
  return cookie.split(";").some((c) => c.trim() === `${SIGNED_IN_HINT_COOKIE}=1`);
}

/** The kept site-wide answers, if they're recent enough to skip asking. */
export function freshSiteFlags(raw: string | null, now: number): SiteFlags | null {
  if (!raw) return null;
  try {
    const flags = JSON.parse(raw) as Partial<SiteFlags>;
    if (typeof flags.enabled !== "boolean" || typeof flags.emailEnabled !== "boolean" || typeof flags.at !== "number") return null;
    return now - flags.at >= 0 && now - flags.at < SITE_FLAGS_MAX_AGE_MS ? (flags as SiteFlags) : null;
  } catch {
    return null;
  }
}
