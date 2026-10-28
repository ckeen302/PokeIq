import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { cognitiveRowOf, logCognitiveResult } from "@/lib/server/cognitive-results";

/**
 * POST /api/iq-test/result — { fluid, memory, speed, spatial, composite }:
 * the raw section scores of a finished Cognitive PokéIQ test, logged
 * anonymously so the norms can be re-fitted on real trainers. No name, no
 * account, no device id. Always answers 200 { stored } once the body is
 * well-formed: the result page never depends on this.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(`iq-test-result:${clientIp(request)}`, 5, 1 / 60)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const row = cognitiveRowOf(await request.json().catch(() => null));
  if (!row) return NextResponse.json({ error: "That doesn't look like a test result." }, { status: 400 });
  const stored = await logCognitiveResult(row);
  return NextResponse.json({ stored });
}
