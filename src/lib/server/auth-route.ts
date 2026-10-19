import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled } from "./accounts";
import { clientIp, rateLimit, tooManyRequests } from "./rate-limit";
import { sameOrigin } from "./auth";

/**
 * Shared guards for the account endpoints: feature flag, CSRF and a per-IP
 * rate limit of `capacity` attempts at once, refilling `perMinute` a minute.
 */
export function guardAuthRequest(request: NextRequest, bucket: string, capacity = 10, perMinute = capacity): NextResponse | null {
  if (!accountsEnabled()) {
    return NextResponse.json({ error: "Trainer accounts aren't enabled on this server yet." }, { status: 503 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  // Slow, steady refill: brute-forcing passwords or recovery codes is impractical.
  if (!rateLimit(`${bucket}:${clientIp(request)}`, capacity, perMinute / 60)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  return null;
}

const TOO_MANY_ATTEMPTS = "Too many attempts — try again in a minute.";

/**
 * A second limit per trainer name, whatever the IP: guessing one account's
 * password from many addresses gets `capacity` tries, then one a minute.
 */
export function guardAccount(bucket: string, username: string, capacity = 10): NextResponse | null {
  return rateLimit(`${bucket}-name:${username.trim().toLowerCase()}`, capacity, 1 / 60) ? null : tooManyRequests(TOO_MANY_ATTEMPTS, 60);
}

export function serverError(err: unknown): NextResponse {
  console.error("[accounts]", err);
  return NextResponse.json({ error: "Something went wrong on our side — try again." }, { status: 500 });
}
