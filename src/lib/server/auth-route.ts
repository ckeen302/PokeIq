import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled } from "./accounts";
import { SHARED_ADDRESS_FACTOR, clientIp, rateLimit, refundRateLimit, tooManyRequests } from "./rate-limit";
import { sameOrigin } from "./auth";

/** The checks every account endpoint starts with: the feature flag and CSRF. */
function guardOrigin(request: NextRequest): NextResponse | null {
  if (!accountsEnabled()) {
    return NextResponse.json({ error: "Trainer accounts aren't enabled on this server yet." }, { status: 503 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  return null;
}

/**
 * Shared guards for the signed-in account endpoints: feature flag, CSRF and a
 * per-IP rate limit of `capacity` attempts at once, refilling `perMinute` a minute.
 */
export function guardAuthRequest(request: NextRequest, bucket: string, capacity = 10, perMinute = capacity): NextResponse | null {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (!rateLimit(`${bucket}:${clientIp(request)}`, capacity, perMinute / 60)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  return null;
}

const TOO_MANY_ATTEMPTS = "Too many attempts — try again in a minute.";

/*
 * Signing in, resetting a password and signing up, behind a shared address.
 *
 * A school or a phone carrier puts hundreds of players behind one address, so
 * the address alone can't carry the limit (ten sign-ins a minute would lock a
 * classroom out), and it can't be dropped either (one client guessing
 * passwords across many accounts). As with gameplay (rate-limit.ts), the
 * strict limit is on the thing being attacked and the address is the backstop:
 *
 * - per account (guardAccount): `capacity` wrong tries, then one a minute,
 *   whatever address they come from;
 * - per address (guardAttempt): wrong tries only. A crowd's burst of typos
 *   fits (FAILURE_BURST times the per-minute rate at once), but the refill
 *   stays at the per-minute rate, so sustained guessing from one address is
 *   no faster than before;
 * - per address, everything (right or wrong): a ceiling SHARED_ADDRESS_FACTOR
 *   times the per-minute rate, which bounds the password hashing one address
 *   can make the server do.
 *
 * Each attempt takes its tokens before the password is checked and gets them
 * back when it was right (attemptSucceeded), so parallel guesses can't share
 * a token and a correct sign-in costs nothing.
 */

/** How many minutes' worth of wrong tries one address may make at once. */
export const FAILURE_BURST = 10;

const failKey = (bucket: string, ip: string) => `${bucket}-fail:${ip}`;
const nameKey = (bucket: string, username: string) => `${bucket}-name:${username.trim().toLowerCase()}`;

/**
 * Feature flag, CSRF and the per-address limits for one attempt at `bucket`
 * (login, recover): `perMinute` wrong tries a minute, FAILURE_BURST minutes'
 * worth at once.
 */
export function guardAttempt(request: NextRequest, bucket: string, perMinute = 10): NextResponse | null {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const ip = clientIp(request);
  if (!rateLimit(`${bucket}-all:${ip}`, perMinute * SHARED_ADDRESS_FACTOR, (perMinute * SHARED_ADDRESS_FACTOR) / 60)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  if (!rateLimit(failKey(bucket, ip), perMinute * FAILURE_BURST, perMinute / 60)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  return null;
}

/**
 * A second limit per trainer name, whatever the IP: guessing one account's
 * password from many addresses gets `capacity` tries, then one a minute.
 * The answer is the same whether or not the name exists.
 */
export function guardAccount(bucket: string, username: string, capacity = 10): NextResponse | null {
  return rateLimit(nameKey(bucket, username), capacity, 1 / 60) ? null : tooManyRequests(TOO_MANY_ATTEMPTS, 60);
}

/** The attempt was right: it doesn't count against the address or the account. */
export function attemptSucceeded(request: NextRequest, bucket: string, username: string, perMinute = 10, capacity = 10): void {
  refundRateLimit(failKey(bucket, clientIp(request)), perMinute * FAILURE_BURST);
  refundRateLimit(nameKey(bucket, username), capacity);
}

/** A classroom can sign up together (this many accounts at once from one address); after that, one a minute. */
export const SIGNUP_BURST = 40;

/**
 * Feature flag, CSRF and the per-address limits for a sign-up: SIGNUP_BURST
 * new accounts at once, then one a minute (a script can't mint thousands),
 * and a looser limit on tries of any kind (a name that's taken, a password
 * that's too short), which also bounds the hashing. A try that makes no
 * account gives its account token back (signupNotMade).
 */
export function guardSignup(request: NextRequest, bucket: string): NextResponse | null {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const ip = clientIp(request);
  if (!rateLimit(`${bucket}-all:${ip}`, SIGNUP_BURST * 3, 1)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  if (!rateLimit(`${bucket}-made:${ip}`, SIGNUP_BURST, 1 / 60)) return tooManyRequests(TOO_MANY_ATTEMPTS, 60);
  return null;
}

/** The sign-up made no account (bad input, name taken, server error): it doesn't count as one. */
export function signupNotMade(request: NextRequest, bucket: string): void {
  refundRateLimit(`${bucket}-made:${clientIp(request)}`, SIGNUP_BURST);
}

export function serverError(err: unknown): NextResponse {
  console.error("[accounts]", err);
  return NextResponse.json({ error: "Something went wrong on our side — try again." }, { status: 500 });
}
