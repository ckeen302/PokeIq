import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { listWatchable } from "@/lib/server/battle-engine/watch";
import { ALL_FORMATS, SPECIAL_FORMATS } from "@/lib/battle/play";
import type { WatchResponse } from "@/lib/battle/watch";

/**
 * GET /api/battle/watch[?format=gen9ou]: live battles anyone may watch
 * (matchmade, or friend battles opened to spectators), newest first, with
 * public facts only. The Watch lobby polls it slowly.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const FORMATS = new Set<string>([...ALL_FORMATS, ...SPECIAL_FORMATS]);

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-watch:${clientIp(request)}`, 20, 1)) return tooManyRequests();
  const raw = request.nextUrl.searchParams.get("format");
  if (raw && !FORMATS.has(raw)) return NextResponse.json({ error: "Unknown format." }, { status: 400, headers: NO_STORE });
  const now = Date.now();
  if (!battlesEnabled()) return NextResponse.json({ now, battles: [] } satisfies WatchResponse, { headers: NO_STORE });
  try {
    const battles = await listWatchable((raw as WatchResponse["battles"][number]["format"]) ?? null, now);
    return NextResponse.json({ now, battles } satisfies WatchResponse, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle-watch]", err);
    return NextResponse.json({ error: "Couldn't load live battles. Try again." }, { status: 503, headers: NO_STORE });
  }
}
