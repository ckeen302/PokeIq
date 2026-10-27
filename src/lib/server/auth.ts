import "server-only";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getSessionUser, type PublicUser } from "./accounts";

/**
 * Authentication primitives on plain Node crypto.
 *
 * - Passwords: scrypt with a per-user random salt (memory-hard, so cracking a
 *   leaked hash on GPUs is expensive), compared in constant time.
 * - Sessions: 256-bit random tokens in an HTTP-only cookie. Only the SHA-256
 *   of the token is stored, so a leaked database can't be replayed as logins.
 * - Recovery codes: no email is collected, so a one-time code shown at signup
 *   is the way back in after a forgotten password.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "pokeiq_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const KEYLEN = 32;

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * Stored as password_hash for accounts made with Discord / Google: it isn't a
 * valid "s1$" hash, so verifyPassword always rejects it and nobody can sign in
 * to such an account with a password.
 */
export const NO_PASSWORD = "none";

export function hasPassword(stored: string): boolean {
  return stored.startsWith("s1$");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `s1$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "s1" || !salt || !hash) return false;
  const candidate = await scryptAsync(password, salt, KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Spend the same scrypt time when the username doesn't exist, so logins can't probe for accounts. */
export async function burnPasswordCheck(password: string): Promise<void> {
  await scryptAsync(password, "0000000000000000", KEYLEN);
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: sha256(token) };
}

export function newUserId(): string {
  return randomUUID();
}

// Crockford-style alphabet: no 0/O/1/I/L to misread when typed back in.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** One-time recovery code, e.g. "K3TR-9WMX-P2HV-8FQZ" (~78 bits). */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  let code = "";
  for (let i = 0; i < 16; i++) {
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i % 4 === 3 && i < 15) code += "-";
  }
  return code;
}

/** The code has plenty of entropy, so a plain SHA-256 is enough for storage. */
export function hashRecoveryCode(code: string): string {
  return sha256(`pokeiq-recovery:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sessionTokenHash(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token && /^[0-9a-f]{64}$/.test(token) ? sha256(token) : null;
}

/** The signed-in trainer for a session cookie's value (a server component's `cookies()`), if any. */
export async function userFromSessionToken(token: string | undefined): Promise<PublicUser | null> {
  return token && /^[0-9a-f]{64}$/.test(token) ? getSessionUser(sha256(token)) : null;
}

/** The signed-in trainer for this request, if any. */
export async function userFromRequest(request: NextRequest): Promise<PublicUser | null> {
  const tokenHash = sessionTokenHash(request);
  return tokenHash ? getSessionUser(tokenHash) : null;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
}

/**
 * Basic CSRF guard for state-changing auth routes: a browser always sends
 * Origin on cross-site POSTs, so reject any that don't match our host.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
