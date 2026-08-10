/**
 * Tiny fixed-window in-memory rate limiter for the auth endpoints —
 * blunts credential-stuffing and signup spam without any infrastructure.
 */
import type { NextRequest } from "next/server";

const globalBuckets = globalThis as unknown as {
  __pokeiqRateLimit?: Map<string, { count: number; resetAt: number }>;
};
const buckets = (globalBuckets.__pokeiqRateLimit ??= new Map());

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
  );
}

/** Returns true when the caller is within `max` hits per `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (buckets.size > 10_000) buckets.clear(); // memory backstop
  return bucket.count <= max;
}
