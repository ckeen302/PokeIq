import { NextResponse } from "next/server";
import { emailEnabled } from "@/lib/server/email/config";
import { runDailyEmail, todayUtc } from "@/lib/server/email/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron, at the daily reset (vercel.json): today's reminder email to
 * every confirmed, opted-in trainer. Does nothing while email is switched
 * off or CRON_SECRET is unset; Vercel sends the secret as a Bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !emailEnabled()) return NextResponse.json({ skipped: true });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runDailyEmail(todayUtc());
    return NextResponse.json(result, { status: result.error ? 502 : 200 });
  } catch (err) {
    console.error("[email] daily run failed:", err);
    return NextResponse.json({ error: "daily email run failed" }, { status: 500 });
  }
}
