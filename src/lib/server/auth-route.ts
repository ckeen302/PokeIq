import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled } from "./accounts";
import { clientIp, rateLimit } from "./rate-limit";
import { sameOrigin } from "./auth";

/** Shared guards for the account endpoints: feature flag, CSRF and rate limit. */
export function guardAuthRequest(request: NextRequest, bucket: string, capacity = 10): NextResponse | null {
  if (!accountsEnabled()) {
    return NextResponse.json({ error: "Trainer accounts aren't enabled on this server yet." }, { status: 503 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  // Slow, steady refill: brute-forcing passwords or recovery codes is impractical.
  if (!rateLimit(`${bucket}:${clientIp(request)}`, capacity, capacity / 60)) {
    return NextResponse.json({ error: "Too many attempts — try again in a minute." }, { status: 429 });
  }
  return null;
}

export function serverError(err: unknown): NextResponse {
  console.error("[accounts]", err);
  return NextResponse.json({ error: "Something went wrong on our side — try again." }, { status: 500 });
}
