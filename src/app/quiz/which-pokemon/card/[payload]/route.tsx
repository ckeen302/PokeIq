import { NextResponse } from "next/server";
import { storyCard } from "@/lib/og/which-pokemon";
import { decodeScores } from "@/lib/which-pokemon/match";

/**
 * GET /quiz/which-pokemon/card/<payload>: the story-sized (1080 × 1920)
 * share card for a result, drawn from the scores in the payload. Same
 * drawing system as the site's link previews; immutable per payload.
 */

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ payload: string }> }) {
  const scores = decodeScores((await context.params).payload);
  if (!scores) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return storyCard(scores);
}
