/**
 * Question API.
 *
 * GET  /api/questions/[category]?count=10&difficulty=mixed
 *      → client-safe questions (answers sealed into opaque tokens)
 * POST /api/questions/[category]  { token, answer }
 *      → verdict { correct, correctAnswer, explanation }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateBatch, type RequestedDifficulty } from "@/engines";
import { isQuizCategory, type ClientQuestion } from "@/engines/types";
import { openAnswer, sealAnswer } from "@/lib/answer-token";
import { UpstreamError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ category: string }> },
) {
  const { category } = await context.params;
  if (!isQuizCategory(category)) {
    return NextResponse.json({ error: "Unknown quiz category" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const count = Math.min(
    10,
    Math.max(1, Number(searchParams.get("count")) || 10),
  );
  const difficultyParam = searchParams.get("difficulty") ?? "mixed";
  if (!DIFFICULTIES.has(difficultyParam)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
  }
  const difficulty = difficultyParam as RequestedDifficulty;

  try {
    const questions = await generateBatch(category, count, difficulty);
    if (questions.length === 0) {
      return NextResponse.json(
        { error: "Could not generate questions — PokéAPI may be unavailable" },
        { status: 502 },
      );
    }
    const clientQuestions: ClientQuestion[] = questions.map((q, index) => ({
      id: `${category}-${Date.now()}-${index}`,
      question: q.question,
      options: q.options,
      imageUrl: q.imageUrl,
      imageHint: q.imageHint,
      optionImages: q.optionImages,
      difficulty: q.difficulty,
      token: sealAnswer(q.correctAnswer, q.explanation),
    }));
    return NextResponse.json(
      { category, questions: clientQuestions },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof UpstreamError ? 502 : 500;
    console.error(`[api/questions/${category}]`, error);
    return NextResponse.json(
      { error: "Question generation failed" },
      { status },
    );
  }
}

const verifySchema = z.object({
  token: z.string().min(20).max(4096),
  /** empty string = timed out without answering */
  answer: z.string().max(200),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ category: string }> },
) {
  const { category } = await context.params;
  if (!isQuizCategory(category)) {
    return NextResponse.json({ error: "Unknown quiz category" }, { status: 404 });
  }

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
