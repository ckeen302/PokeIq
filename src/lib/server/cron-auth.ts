import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron's call: `Authorization: Bearer <CRON_SECRET>`. Compared in
 * constant time (both sides hashed to the same length first), so the
 * secret can't be guessed a character at a time from response times.
 */
export function cronAuthorized(authorization: string | null | undefined, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || !authorization) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
