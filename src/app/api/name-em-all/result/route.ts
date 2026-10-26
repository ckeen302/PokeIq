import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { secretIsSecure } from "@/lib/server/crypto";
import { duelNameSchema } from "@/lib/server/duel-core";
import { checkRun, neaElapsed, neaPlayerKey, neaStore, placeOf, readClaim, signClaim, type NeaClaim } from "@/lib/server/name-em-all-board";
import { parseScope } from "@/lib/server/name-em-all";
import type { NeaBoard, NeaResultResponse } from "@/lib/name-em-all/types";

/**
 * POST /api/name-em-all/result
 *   { scope, player, token, named, times, ms, name? }   a finished ranked run
 *   { claim, player, name }                             post a checked run under a name
 *
 * The run is checked against the server's start token (see
 * name-em-all-board). Signed-in trainers post under their account name;
 * anyone else needs a name, and gets a claim to send back with one.
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
  name: duelNameSchema.optional(),
});
const claimSchema = z.object({ claim: z.string().max(1000), player, name: duelNameSchema });

const json = (body: NeaResultResponse | { error: string }, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function post(claim: NeaClaim, name: string): Promise<NeaResultResponse> {
  const store = neaStore();
  const counted = claim.count?.named ?? 0;
  if (!store) return { ranked: false, reason: "Leaderboards aren't available on this server.", counted };
  const places: NeaResultResponse["places"] = {};
  const entries: [NeaBoard, number, number][] = [];
  if (claim.clear !== null && !claim.daily) entries.push(["clear", claim.total, claim.clear]);
  if (claim.count) entries.push(["count", claim.count.named, claim.count.ms]);
  for (const [board, named, ms] of entries) {
    const saved = await store.submit(claim.s, board, { player: claim.k, name, named, total: claim.total, ms }, claim.daily);
    if (saved === null) return { ranked: false, reason: "Leaderboards aren't available right now.", counted };
    const rows = await store.board(claim.s, board);
    const place = rows ? placeOf(rows, claim.k) : null;
    if (place) places[board] = place;
  }
  if (!entries.length) return { ranked: false, reason: "Name at least one Pokémon in the standard time to rank.", counted };
  return { ranked: true, counted, places };
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`nea-result:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const body = await request.json().catch(() => ({}));
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) return json({ ranked: false, reason: "Leaderboards are off on this server.", counted: 0 });

  try {
    if (body && typeof body === "object" && "claim" in body) {
      const parsed = claimSchema.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
      const claim = readClaim(parsed.data.claim);
      const key = neaPlayerKey(user ? `u:${user.id}` : `d:${parsed.data.player}`);
      if (!claim || claim.k !== key) return json({ error: "That result has expired. Play again to rank." }, 400);
      return json(await post(claim, user ? user.username : parsed.data.name));
    }

    const parsed = runSchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    const d = parsed.data;
    const scope = parseScope(d.scope);
    if (!scope) return json({ error: "No such quiz." }, 400);
    const key = neaPlayerKey(user ? `u:${user.id}` : `d:${d.player}`);
    const wallMs = neaElapsed(d.token, scope.scope, key);
    if (wallMs === null) return json({ ranked: false, reason: "This run has no start time from our server.", counted: 0 });
    const check = checkRun({ total: scope.total, limitMs: scope.limitMs, named: d.named, times: d.times, ms: d.ms, wallMs });
    if (!check.ok) return json({ ranked: false, reason: check.reason, counted: 0 });
    const claim: NeaClaim = { s: scope.scope, k: key, daily: !!scope.daily, total: scope.total, clear: check.clear, count: check.count, t: Date.now() };
    const name = user ? user.username : (d.name ?? null);
    if (!name) return json({ ranked: false, reason: "Add a trainer name to post your result.", counted: check.count?.named ?? 0, claim: signClaim(claim) });
    return json(await post(claim, name));
  } catch (err) {
    console.error("[name-em-all] result failed:", err);
    return json({ error: "Couldn't post the result." }, 503);
  }
}
