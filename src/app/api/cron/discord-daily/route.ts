import { NextResponse } from "next/server";
import { dailyEmbed } from "@/lib/discord/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel Cron: posts today's game links to the Discord webhook. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const hook = process.env.DISCORD_DAILY_WEBHOOK_URL;
  if (!secret || !hook) return NextResponse.json({ skipped: true });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ embeds: [dailyEmbed()] }) }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "webhook failed" }, { status: 502 });
  return NextResponse.json({ posted: true });
}
