import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { usersByNames } from "@/lib/server/accounts";
import { USERNAME_RE } from "@/lib/server/auth";
import { geoStatsKey } from "@/lib/server/geo-round-scores";
import { versusStatsOf } from "@/lib/server/geo-duel-stats";
import type { VersusStatsResponse } from "@/lib/duel-stats";

/**
 * GET /api/geo/duel-stats?names=a,b — the public PokéGuessr duel stats of up
 * to two trainers (by account name), for the versus intro before a duel:
 * nothing beyond what their profile page shows, read from their logged rounds.
 * Names that aren't accounts come back null.
 */

const querySchema = z.object({
  names: z
    .string()
    .max(64)
    .transform((s) => [...new Set(s.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(z.string()).min(1).max(2)),
});

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-duel-stats:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const names = query.data.names;
  const stats: VersusStatsResponse["stats"] = Object.fromEntries(names.map((n) => [n, null]));
  const accounts = await usersByNames(names.filter((n) => USERNAME_RE.test(n))).catch(() => []);
  await Promise.all(
    accounts.map(async (user) => {
      stats[user.username.toLowerCase()] = await versusStatsOf(geoStatsKey(`u:${user.id}`));
    })
  );
  return NextResponse.json({ stats } satisfies VersusStatsResponse, { headers: { "Cache-Control": "private, max-age=30" } });
}
