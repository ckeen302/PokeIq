/** GET /api/auth/me — who am I, my server-side stats, my global rank. */
import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { getRank, getStats } from "@/lib/auth-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { user: null },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const [stats, rank] = await Promise.all([
    getStats(user.id),
    getRank(user.id),
  ]);
  return NextResponse.json(
    { user, stats, rank },
    { headers: { "cache-control": "no-store" } },
  );
}
