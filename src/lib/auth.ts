/**
 * Authentication primitives — no framework, just Node crypto done right.
 *
 * - Passwords: scrypt with a per-user random salt (memory-hard, so GPU
 *   cracking of a leaked hash is expensive). Constant-time comparison.
 * - Sessions: 256-bit random bearer tokens in an HTTP-only cookie. Only the
 *   SHA-256 of the token is stored server-side, so a leaked database cannot
 *   be replayed as live sessions.
 */
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getSessionUser, type PublicUser } from "./auth-store";

export const SESSION_COOKIE = "pokeiq_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `s1$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "s1" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newUserId(): string {
  return randomUUID();
}

/* ------------------------------------------------------------------ */
/* Recovery codes — offline account recovery without collecting email  */
/* ------------------------------------------------------------------ */

// Crockford-style alphabet: no 0/O/1/I/L ambiguity when read back.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** One-time recovery code, e.g. "K3TR-9WMX-P2HV-8FQZ" (~79 bits entropy). */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  let code = "";
  for (let i = 0; i < 16; i++) {
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i % 4 === 3 && i < 15) code += "-";
  }
  return code;
}

/** Hash for storage/lookup — input entropy is high, so SHA-256 suffices. */
export function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHash("sha256").update(`pokeiq-recovery:${normalized}`).digest("hex");
}

/** Resolve the signed-in user from the request's session cookie, if any. */
export async function userFromRequest(
  request: NextRequest,
): Promise<PublicUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(hashSessionToken(token));
}

/** Attach the session cookie to a response. */
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
