import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { ReplaysUnavailable, replayStore } from "@/lib/server/battle-engine/replays";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { ALL_FORMATS, SPECIAL_FORMATS, type PlayFormatId } from "@/lib/battle/play";
import { REPLAY_ID_RE, type ReplayListResponse } from "@/lib/battle/replay";

/**
 * GET /api/battle/replays?scope=recent[&format=gen9ou]: public replays, newest first.
 * GET /api/battle/replays?scope=mine[&ids=a,b]: your replays (header
 *     x-ranked-id: this browser's signed id; a signed-in trainer is their
 *     account), plus the ones this device remembers (`ids`).
 * Summaries only (no logs). { available: false } until replays are on.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({
  scope: z.enum(["recent", "mine"]).default("recent"),
  format: z.enum([...SPECIAL_FORMATS, ...ALL_FORMATS] as [PlayFormatId, ...PlayFormatId[]]).optional(),
  ids: z
    .string()
    .max(600)
    .optional()
    .transform((s) => (s ? s.split(",").filter((id) => REPLAY_ID_RE.test(id)).slice(0, 50) : [])),
});

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-replays:${clientIp(request)}`, 20, 1)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const store = replayStore();
  if (!store) return NextResponse.json({ available: false, replays: [] } satisfies ReplayListResponse, { headers: NO_STORE });
  try {
    const { scope, format, ids } = query.data;
    const replays =
      scope === "recent"
        ? await store.recent(format ?? null, 50)
        : await store.mine(await battlePlayerKey(request, request.headers.get("x-ranked-id")), ids, 50);
    return NextResponse.json({ available: true, replays } satisfies ReplayListResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ReplaysUnavailable) return NextResponse.json({ available: false, replays: [] } satisfies ReplayListResponse, { headers: NO_STORE });
    console.error("[replays]", err);
    return NextResponse.json({ error: "Couldn't load replays. Try again." }, { status: 503, headers: NO_STORE });
  }
}
