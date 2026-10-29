import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { rankedIdentity } from "@/lib/server/ranked";
import { geoRankedKey } from "@/lib/server/geo-ranked";
import { HistoryUnavailable, canShareReplay, historyStore, replayFor } from "@/lib/server/geo-duel-history";
import { DUEL_CODE_RE } from "@/lib/duel-types";

/**
 * GET  /api/geo/history/:code — a kept duel's replay. Only for the two
 *      trainers who played it (their account, or the signed id their browser
 *      sends in x-ranked-id), or for anyone once one of them has shared it.
 *      Anything else is a 404, so a code says nothing about whether it exists.
 * POST /api/geo/history/:code — { public: boolean }: a trainer who played it
 *      shares (or unshares) the replay's link.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const idSchema = z.string().min(10).max(200).nullable();
const bodySchema = z.object({ public: z.boolean() });

type Context = { params: Promise<{ code: string }> };

const notFound = () => NextResponse.json({ error: "No such replay, or it isn't yours to see." }, { status: 404, headers: NO_STORE });

async function viewer(request: NextRequest): Promise<string | null> {
  const sent = idSchema.safeParse(request.headers.get("x-ranked-id"));
  const identity = await rankedIdentity(request, sent.success ? sent.data : null);
  return identity ? geoRankedKey(identity) : null;
}

export async function GET(request: NextRequest, context: Context) {
  if (!rateLimit(`geo-replay:${clientIp(request)}`, 30, 1)) return tooManyRequests();
  const { code } = await context.params;
  if (!DUEL_CODE_RE.test(code)) return notFound();
  const store = historyStore();
  if (!store) return notFound();
  try {
    const [row, key] = await Promise.all([store.get(code), viewer(request)]);
    const replay = row && replayFor(row, key);
    return replay ? NextResponse.json(replay, { headers: NO_STORE }) : notFound();
  } catch (err) {
    if (err instanceof HistoryUnavailable) return notFound();
    console.error("[geo-replay]", err);
    return NextResponse.json({ error: "Replays hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!rateLimit(`geo-replay-share:${clientIp(request)}`, 10, 0.2)) return tooManyRequests();
  const { code } = await context.params;
  if (!DUEL_CODE_RE.test(code)) return notFound();
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const store = historyStore();
  if (!store) return notFound();
  try {
    const [row, key] = await Promise.all([store.get(code), viewer(request)]);
    if (!row || !canShareReplay(row, key)) return notFound();
    await store.setPublic(code, body.data.public);
    return NextResponse.json({ public: body.data.public }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof HistoryUnavailable) return notFound();
    console.error("[geo-replay]", err);
    return NextResponse.json({ error: "Replays hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
