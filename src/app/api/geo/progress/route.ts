import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { geoStatsKey } from "@/lib/server/geo-round-scores";
import { achievementStates, geoProgressFor, masteryFromRounds, metricsFromRounds } from "@/lib/server/geo-progress";

/**
 * GET /api/geo/progress — the caller's PokéGuessr achievements and mastery,
 * worked out on the server from the rounds logged for them: their account
 * when signed in, else this device (the cookie /api/geo/guess sets). A
 * device that has never played gets everything at zero.
 */

const DEVICE_COOKIE = "piq_geo_id";
const DEVICE_RE = /^[A-Za-z0-9_-]{12,32}$/;

/** What a device that has never played gets (the same as geoProgressFor finds for a key with nothing logged). */
const noProgress = () => ({ achievements: achievementStates(metricsFromRounds([]), new Map()), mastery: masteryFromRounds([]), rounds: 0, perfectRounds: 0 });

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-progress:${clientIp(request)}`, 20, 0.5)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const device = request.cookies.get(DEVICE_COOKIE)?.value;
  const key = user ? geoStatsKey(`u:${user.id}`) : device && DEVICE_RE.test(device) ? geoStatsKey(`d:${device}`) : null;
  // A device that has never played has nothing logged: everything at zero, without reading the database.
  const progress = key ? await geoProgressFor({ key, ...(user ? { userId: user.id, username: user.username } : {}) }) : noProgress();
  return NextResponse.json({ ...progress, signedIn: !!user, ...(user ? { username: user.username } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
