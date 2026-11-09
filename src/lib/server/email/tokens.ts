import "server-only";
import { signToken, verifyToken } from "../crypto";

/**
 * Email links, HMAC-signed with the server secret (nothing stored):
 * - confirm: proves the trainer can read mail at that address. Carries the
 *   address, so a link for an old address can't confirm a new one, and
 *   expires after a week.
 * - unsubscribe: turns the daily email off for that trainer. It never
 *   expires: an unsubscribe link in an old email must keep working.
 */

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ConfirmPayload {
  u: string;
  e: string;
  x: number;
}

export function confirmToken(profileId: string, email: string, now = Date.now()): string {
  return signToken("email-confirm", { u: profileId, e: email, x: now + CONFIRM_TTL_MS } satisfies ConfirmPayload);
}

export function verifyConfirmToken(token: unknown, now = Date.now()): { profileId: string; email: string } | null {
  const p = verifyToken<ConfirmPayload>("email-confirm", token);
  if (!p || typeof p.u !== "string" || typeof p.e !== "string" || typeof p.x !== "number" || p.x <= now) return null;
  return { profileId: p.u, email: p.e };
}

export function unsubscribeToken(profileId: string): string {
  return signToken("email-unsub", { u: profileId });
}

export function verifyUnsubscribeToken(token: unknown): string | null {
  const p = verifyToken<{ u?: unknown }>("email-unsub", token);
  return p && typeof p.u === "string" && p.u.length <= 64 ? p.u : null;
}
