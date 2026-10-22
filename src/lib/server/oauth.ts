import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { NextResponse } from "next/server";
import {
  createUser,
  deleteIdentity,
  deleteProfile,
  findIdentity,
  findUserByName,
  findUserRecordById,
  identitiesOf,
  insertIdentity,
  touchIdentity,
  type IdentityRecord,
  type UserRecord,
} from "./accounts";
import { NO_PASSWORD, USERNAME_RE, hasPassword, newUserId } from "./auth";
import { decryptJson, encryptJson } from "./crypto";
import { sanctionOf } from "./moderation";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { isOAuthProvider, type OAuthErrorCode, type OAuthProvider, type OwnIdentity } from "@/lib/oauth";

/**
 * Sign in with Discord / Google, server-side, through Supabase Auth.
 *
 * 1. /api/auth/oauth/[provider] makes a PKCE verifier + a `state`, seals both
 *    in a short-lived encrypted httpOnly cookie, and sends the browser to
 *    Supabase's /authorize (S256 challenge, fixed redirect back to us).
 * 2. /api/auth/oauth/callback checks `state` against the cookie, then trades
 *    the code + verifier for the Supabase user (server to server; the
 *    Supabase tokens are revoked and never reach the browser).
 * 3. The provider identity maps to a PokéIQ profile through auth_identities,
 *    and the normal PokéIQ session cookie is issued.
 */

export const FLOW_COOKIE = "pokeiq_oauth";
export const SIGNUP_COOKIE = "pokeiq_oauth_signup";
export const OAUTH_COOKIE_PATH = "/api/auth/oauth";
export const CALLBACK_PATH = "/api/auth/oauth/callback";
export const FLOW_TTL_MS = 10 * 60_000;
export const SIGNUP_TTL_MS = 15 * 60_000;

export type Intent = "signin" | "link";

interface Flow {
  /** provider */
  p: OAuthProvider;
  /** state */
  s: string;
  /** PKCE code verifier */
  v: string;
  /** intent */
  i: Intent;
  exp: number;
}

export function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function oauthCookieOptions(maxAgeMs: number, siteUrl: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || siteUrl.startsWith("https:"),
    sameSite: "lax" as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export function clearOAuthCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { maxAge: 0, path: OAUTH_COOKIE_PATH });
}

/** Starts a handshake: the sealed cookie value and the Supabase URL to send the browser to. */
export function startFlow(
  provider: OAuthProvider,
  intent: Intent,
  opts: { siteUrl: string; supabaseUrl: string; now?: number }
): { cookie: string; authorizeUrl: string } {
  const verifier = randomBytes(32).toString("base64url"); // 43 chars: RFC 7636's minimum, 256 bits
  const state = randomBytes(24).toString("base64url");
  const flow: Flow = { p: provider, s: state, v: verifier, i: intent, exp: (opts.now ?? Date.now()) + FLOW_TTL_MS };
  const url = new URL(`${opts.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set("provider", provider);
  // Fixed path on our own origin: nothing from the request decides where the browser lands.
  url.searchParams.set("redirect_to", `${opts.siteUrl}${CALLBACK_PATH}?state=${state}`);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "s256");
  return { cookie: encryptJson(flow, "oauth-flow"), authorizeUrl: url.toString() };
}

/** The handshake this cookie belongs to, if it's intact, unexpired and `state` matches; else null. */
export function verifyFlow(cookie: string | undefined, state: string | null, now = Date.now()): Flow | null {
  if (!cookie || !state || cookie.length > 2048 || state.length > 128) return null;
  const flow = decryptJson<Flow>(cookie, "oauth-flow");
  if (!flow || !isOAuthProvider(flow.p) || (flow.i !== "signin" && flow.i !== "link")) return null;
  if (typeof flow.exp !== "number" || flow.exp <= now || typeof flow.s !== "string" || typeof flow.v !== "string") return null;
  const a = Buffer.from(flow.s);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b) ? flow : null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Trades the auth code + PKCE verifier for the Supabase session, or null if Supabase refuses. */
export async function exchangeCode(
  code: string,
  verifier: string,
  cfg: { url: string; key: string },
  fetchImpl: FetchLike = fetch
): Promise<{ accessToken: string | null; user: unknown } | null> {
  const res = await fetchImpl(`${cfg.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: cfg.key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn("[oauth] code exchange refused:", res.status);
    return null;
  }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; user?: unknown } | null;
  if (!body?.user) return null;
  return { accessToken: typeof body.access_token === "string" ? body.access_token : null, user: body.user };
}

/** Ends the throwaway Supabase session at once: only the PokéIQ session is ever used. */
export async function revokeSupabaseSession(accessToken: string, cfg: { url: string; key: string }, fetchImpl: FetchLike = fetch): Promise<void> {
  await fetchImpl(`${cfg.url}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

export interface ProviderIdentity {
  provider: OAuthProvider;
  providerUserId: string;
  /** Only when the provider says it's verified. */
  email: string | null;
  displayName: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The `provider` identity on a Supabase user. Supabase may merge several
 * providers into one user (same email), so pick the one we just asked for.
 */
export function identityFromUser(user: unknown, provider: OAuthProvider): ProviderIdentity | null {
  const identities = (user as { identities?: unknown } | null)?.identities;
  if (!Array.isArray(identities)) return null;
  const hit = identities.find((i) => (i as { provider?: unknown })?.provider === provider) as
    | { id?: unknown; provider_id?: unknown; identity_data?: Record<string, unknown> }
    | undefined;
  if (!hit) return null;
  const data = hit.identity_data ?? {};
  const providerUserId = str(data.sub) ?? str(data.provider_id) ?? str(hit.provider_id) ?? str(hit.id);
  if (!providerUserId || providerUserId.length > 255) return null;
  const rawEmail = str(data.email);
  const verified = data.email_verified === true || data.email_verified === "true";
  const email = verified && rawEmail && rawEmail.length <= 320 && rawEmail.includes("@") ? rawEmail.toLowerCase() : null;
  const claims = (data.custom_claims ?? {}) as Record<string, unknown>;
  const displayName =
    str(claims.global_name) ?? str(data.full_name) ?? str(data.name) ?? str(data.user_name) ?? str(data.preferred_username);
  return { provider, providerUserId, email, displayName };
}

// ---------------------------------------------------------------------------
// Trainer names
// ---------------------------------------------------------------------------

const FALLBACK_NAME = "Trainer";

/** A valid, clean trainer name from a provider display name (or "Trainer"). */
export function sanitizeUsername(raw: string | null): string {
  const name = (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s.]+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/[_-]{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 20);
  return USERNAME_RE.test(name) && isCleanName(name) ? name : FALLBACK_NAME;
}

/** `base`, or `base` + digits, that nobody has taken yet. */
export async function uniqueUsername(base: string, isTaken: (name: string) => Promise<boolean>): Promise<string> {
  if (base !== FALLBACK_NAME && !(await isTaken(base))) return base;
  for (let i = 0; i < 8; i++) {
    const suffix = String(randomInt(i < 4 ? 100 : 10_000, i < 4 ? 1000 : 100_000));
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (USERNAME_RE.test(candidate) && isCleanName(candidate) && !(await isTaken(candidate))) return candidate;
  }
  return `${FALLBACK_NAME}${randomInt(100_000, 1_000_000)}`;
}

export const nameTaken = async (name: string) => (await findUserByName(name)) !== null;

// ---------------------------------------------------------------------------
// A new identity's signup, waiting for the trainer to pick a name
// ---------------------------------------------------------------------------

export interface PendingSignup {
  p: OAuthProvider;
  id: string;
  e: string | null;
  n: string;
  exp: number;
}

export function sealSignup(identity: ProviderIdentity, suggestion: string, now = Date.now()): string {
  const pending: PendingSignup = { p: identity.provider, id: identity.providerUserId, e: identity.email, n: suggestion, exp: now + SIGNUP_TTL_MS };
  return encryptJson(pending, "oauth-signup");
}

export function openSignup(cookie: string | undefined, now = Date.now()): PendingSignup | null {
  if (!cookie || cookie.length > 4096) return null;
  const p = decryptJson<PendingSignup>(cookie, "oauth-signup");
  if (!p || !isOAuthProvider(p.p) || typeof p.id !== "string" || typeof p.exp !== "number" || p.exp <= now) return null;
  return p;
}

export const AGE_REQUIRED = "You need to be 13 or older to make an account.";

export const signupSchema = z.object({
  username: z.string().regex(USERNAME_RE, "Trainer names are 3–20 letters, numbers, _ or -.").refine(isCleanName, NAME_REJECTED),
  // US COPPA: no accounts for under-13s.
  ageConfirmed: z.boolean({ required_error: AGE_REQUIRED, invalid_type_error: AGE_REQUIRED }).refine((v) => v === true, AGE_REQUIRED),
});

// ---------------------------------------------------------------------------
// Identity -> profile
// ---------------------------------------------------------------------------

export interface OAuthDeps {
  findIdentity(provider: string, providerUserId: string): Promise<IdentityRecord | null>;
  identitiesOf(profileId: string): Promise<IdentityRecord[]>;
  insertIdentity(rec: IdentityRecord): Promise<IdentityRecord | "conflict">;
  deleteIdentity(profileId: string, provider: string): Promise<void>;
  touchIdentity(provider: string, providerUserId: string, email: string | null): Promise<void>;
  findUserRecordById(id: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<UserRecord | "taken">;
  deleteProfile(id: string): Promise<void>;
  isBanned(profileId: string): Promise<boolean>;
}

export const defaultDeps: OAuthDeps = {
  findIdentity,
  identitiesOf,
  insertIdentity,
  deleteIdentity,
  touchIdentity,
  findUserRecordById,
  createUser,
  deleteProfile,
  isBanned: async (id) => Boolean((await sanctionOf(id))?.banned),
};

export type SignInOutcome = { kind: "signed_in"; profileId: string } | { kind: "new" } | { kind: "error"; code: OAuthErrorCode };

/** Sign-in with a provider identity: its profile, a new trainer, or a refusal (banned). */
export async function resolveSignIn(identity: ProviderIdentity, deps: OAuthDeps = defaultDeps): Promise<SignInOutcome> {
  const existing = await deps.findIdentity(identity.provider, identity.providerUserId);
  if (!existing) return { kind: "new" };
  if (!(await deps.findUserRecordById(existing.profileId))) return { kind: "error", code: "failed" };
  if (await deps.isBanned(existing.profileId)) return { kind: "error", code: "banned" };
  if (existing.email !== identity.email) await deps.touchIdentity(identity.provider, identity.providerUserId, identity.email);
  return { kind: "signed_in", profileId: existing.profileId };
}

function record(identity: { provider: string; providerUserId: string; email: string | null }, profileId: string): IdentityRecord {
  const now = new Date().toISOString();
  return { provider: identity.provider, providerUserId: identity.providerUserId, profileId, email: identity.email, createdAt: now, updatedAt: now };
}

/** Links a provider identity to the signed-in trainer. */
export async function linkIdentity(profileId: string, identity: ProviderIdentity, deps: OAuthDeps = defaultDeps): Promise<"linked" | OAuthErrorCode> {
  const existing = await deps.findIdentity(identity.provider, identity.providerUserId);
  if (existing) {
    if (existing.profileId !== profileId) return "linked_elsewhere";
    await deps.touchIdentity(identity.provider, identity.providerUserId, identity.email);
    return "linked";
  }
  if ((await deps.identitiesOf(profileId)).some((i) => i.provider === identity.provider)) return "already_linked";
  const inserted = await deps.insertIdentity(record(identity, profileId));
  if (inserted === "conflict") {
    const now = await deps.findIdentity(identity.provider, identity.providerUserId);
    return now?.profileId === profileId ? "linked" : now ? "linked_elsewhere" : "already_linked";
  }
  return "linked";
}

/** Unlinks, unless it's the trainer's last way to sign in. */
export async function unlinkIdentity(
  profileId: string,
  provider: OAuthProvider,
  deps: OAuthDeps = defaultDeps
): Promise<"unlinked" | "not_linked" | "last_method"> {
  const [user, mine] = await Promise.all([deps.findUserRecordById(profileId), deps.identitiesOf(profileId)]);
  if (!user || !mine.some((i) => i.provider === provider)) return "not_linked";
  const others = mine.filter((i) => i.provider !== provider);
  if (!hasPassword(user.passwordHash) && others.length === 0) return "last_method";
  await deps.deleteIdentity(profileId, provider);
  return "unlinked";
}

/** Makes the trainer for a pending signup: no password, no recovery code, the identity linked. */
export async function completeSignup(
  pending: PendingSignup,
  username: string,
  deps: OAuthDeps = defaultDeps
): Promise<UserRecord | "taken" | "exists"> {
  if (await deps.findIdentity(pending.p, pending.id)) return "exists";
  const user = await deps.createUser({
    id: newUserId(),
    username,
    passwordHash: NO_PASSWORD,
    recoveryCodeHash: null,
    createdAt: new Date().toISOString(),
  });
  if (user === "taken") return "taken";
  const linked = await deps.insertIdentity(record({ provider: pending.p, providerUserId: pending.id, email: pending.e }, user.id));
  if (linked === "conflict") {
    // Another tab finished first: don't leave a trainer nobody can sign in to.
    await deps.deleteProfile(user.id);
    return "exists";
  }
  return user;
}

/** The owner's own view of their connected accounts (includes their email: never use for anyone else). */
export function ownIdentities(list: IdentityRecord[]): OwnIdentity[] {
  return list.filter((i) => isOAuthProvider(i.provider)).map((i) => ({ provider: i.provider as OAuthProvider, email: i.email, linkedAt: i.createdAt }));
}
