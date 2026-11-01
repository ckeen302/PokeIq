import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { secretIsSecure } from "@/lib/server/crypto";
import { checkRun, neaElapsed, neaPlayerKey, neaStore, type NeaClaim } from "@/lib/server/name-em-all-board";
import { parseScope } from "@/lib/server/name-em-all";
import type { NeaBoard, NeaResultResponse } from "@/lib/name-em-all/types";

/**
 * POST /api/name-em-all/result { scope, player, token, named, times, ms }
 *
 * A finished Regular run, checked against the server's start token (see
 * name-em-all-board). There are no leaderboards: a signed-in trainer's
 * checked run is kept as their personal best for the category (the most
 * named inside the standard time, and the fastest full clear), shown on
 * their profile. Runs by trainers who aren't signed in are checked and not
 * kept (their bests stay on their device). Old clients may still send a
 * `name` or a `claim`: both are ignored.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const player = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id.");
const runSchema = z.object({
  scope: z.string().max(40),
  player,
  token: z.string().max(600),
  named: z.array(z.number().int().min(0).max(2000)).max(1100),
  times: z.array(z.number().min(0).max(1e8)).max(1100),
  ms: z.number().min(0).max(1e8),
});

const json = (body: NeaResultResponse | { error: string }, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Keeps the run as the trainer's best where it beats what they have. */
async function save(claim: NeaClaim, name: string): Promise<NeaResultResponse> {
  const store = neaStore();
  const counted = claim.count?.named ?? 0;
  if (!store) return { saved: false, reason: "Personal bests aren't kept on this server.", counted };
  const entries: [NeaBoard, number, number][] = [];
  if (claim.clear !== null && !claim.daily) entries.push(["clear", claim.total, claim.clear]);
  if (claim.count) entries.push(["count", claim.count.named, claim.count.ms]);
  if (!entries.length) return { saved: false, reason: "Name at least one Pokémon in the standard time to set a best.", counted };
  let improved = false;
  for (const [board, named, ms] of entries) {
    const stored = await store.submit(claim.s, board, { player: claim.k, name, named, total: claim.total, ms }, claim.daily);
    if (stored === null) return { saved: false, reason: "Personal bests aren't available right now.", counted };
    improved ||= stored;
  }
  return { saved: true, improved, counted };
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`nea-result:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const body = await request.json().catch(() => ({}));
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) return json({ saved: false, reason: "Personal bests are off on this server.", counted: 0 });

  try {
    if (body && typeof body === "object" && "claim" in body) return json({ saved: false, reason: "Sign in to keep your best on your profile.", counted: 0 });
    const parsed = runSchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    const d = parsed.data;
    const scope = parseScope(d.scope);
    if (!scope) return json({ error: "No such quiz." }, 400);
    const key = neaPlayerKey(user ? `u:${user.id}` : `d:${d.player}`);
    const wallMs = neaElapsed(d.token, scope.scope, key);
    if (wallMs === null) return json({ saved: false, reason: "This run has no start time from our server.", counted: 0 });
    const check = checkRun({ total: scope.total, limitMs: scope.limitMs, named: d.named, times: d.times, ms: d.ms, wallMs });
    if (!check.ok) return json({ saved: false, reason: check.reason, counted: 0 });
    const counted = check.count?.named ?? 0;
    if (!user) return json({ saved: false, reason: "Sign in to keep your best on your profile.", counted, signIn: true });
    const claim: NeaClaim = { s: scope.scope, k: key, daily: !!scope.daily, total: scope.total, clear: check.clear, count: check.count, t: Date.now() };
    return json(await save(claim, user.username));
  } catch (err) {
    console.error("[name-em-all] result failed:", err);
    return json({ error: "Couldn't check the result." }, 503);
  }
}
