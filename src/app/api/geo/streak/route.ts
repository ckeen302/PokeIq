import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { optionalName } from "@/lib/name-filter";
import { startStreak } from "@/lib/server/geo-streak";
import { syncHiddenShots } from "@/lib/server/geo-reports";

/**
 * POST /api/geo/streak — start a Region Streak run: { name? }. Returns the
 * run's token, the first screenshot and the regions to pick from. The place
 * and its region stay on the server until a pick is graded.
 */

const bodySchema = z.object({ name: z.string().trim().max(24).optional() });

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-streak-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many runs started — take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  await syncHiddenShots();
  return NextResponse.json(startStreak({ name: optionalName(parsed.data.name) }), { headers: { "Cache-Control": "no-store" } });
}
