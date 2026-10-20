import { NextResponse } from "next/server";
import { liveCounts } from "@/lib/server/live-counts";

/**
 * GET /api/live -> { online, battles }: the battle home's live counters.
 * The same for everyone, so the CDN keeps each answer for 30 s (and serves
 * it a little longer while it refreshes): a handful of function runs a
 * minute however many trainers are looking.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await liveCounts();
  return NextResponse.json(counts, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30" } });
}
