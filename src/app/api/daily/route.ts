/**
 * Daily Gauntlet API.
 * GET  /api/daily             → today's sealed questions (same for everyone)
 * POST /api/daily {token,answer} → verdict
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ClientQuestion } from "@/engines/types";
import { openAnswer, sealAnswer } from "@/lib/answer-token";
import { getDailyChallenge } from "@/lib/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const daily = await getDailyChallenge();
    const questions: ClientQuestion[] = daily.questions.map((q, index) => ({
      id: `daily-${daily.dateKey}-${index}`,
      question: q.question,
      options: q.options,
      imageUrl: q.imageUrl,
      imageHint: q.imageHint,
      optionImages: q.optionImages,
      difficulty: q.difficulty,
      token: sealAnswer(q.correctAnswer, q.explanation),
    }));
    return NextResponse.json(
      {
        dateKey: daily.dateKey,
        dayNumber: daily.dayNumber,
        endsAt: daily.endsAt,
        questions,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[api/daily]", error);
    return NextResponse.json(
      { error: "Daily challenge generation failed — try again shortly" },
      { status: 502 },
    );
  }
}

const verifySchema = z.object({
  token: z.string().min(20).max(4096),
  answer: z.string().max(200),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const payload = openAnswer(parsed.data.token);
  if (!payload) {
    return NextResponse.json(
      { error: "Answer token invalid or expired" },
      { status: 410 },
    );
  }
  return NextResponse.json({
    correct: parsed.data.answer === payload.a,
    correctAnswer: payload.a,
    explanation: payload.e,
  });
}
