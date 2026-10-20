import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { RankedUnavailable, newAnonId } from "@/lib/server/ranked";
import { ladderStore } from "@/lib/server/battle-engine/ladder";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { LADDER_FORMATS, type LadderResponse } from "@/lib/battle/ladder";
import type { StandardFormatId } from "@/lib/battle/play";

/**
 * GET /api/battle/ladder?format=gen9ou[&top=1]: your standing on that
 * format's ladder (header x-ranked-id: the signed id this browser has; a
 * signed-in trainer is their account) and, with top=1, the top 100.
 * A browser without a valid id gets one (`id`) to keep and send back.
 * { available: false } while the ladder is off (migration 0018).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({
  format: z.enum(LADDER_FORMATS as [StandardFormatId, ...StandardFormatId[]]).default("gen9randombattle"),
  top: z.enum(["1"]).optional(),
});

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-ladder:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const { format, top } = query.data;
  let key = await battlePlayerKey(request, request.headers.get("x-ranked-id"));
  let id: string | undefined;
  if (!key) {
    id = newAnonId();
    key = await battlePlayerKey(request, id);
  }
  const store = ladderStore();
  if (!store) return NextResponse.json({ available: false, id } satisfies LadderResponse, { headers: NO_STORE });
  try {
    const [you, leaders] = await Promise.all([key ? store.standing(key, format) : null, top ? store.top(format, 100) : undefined]);
    return NextResponse.json({ available: true, id, format, you, top: leaders } satisfies LadderResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RankedUnavailable) return NextResponse.json({ available: false, id } satisfies LadderResponse, { headers: NO_STORE });
    console.error("[battle-ladder]", err);
    return NextResponse.json({ error: "The ladder hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
