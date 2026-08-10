import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuizController } from "@/components/quiz/QuizController";
import {
  CATEGORY_META,
  QUIZ_CATEGORIES,
  isQuizCategory,
} from "@/engines/types";

export function generateStaticParams() {
  return QUIZ_CATEGORIES.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  if (!isQuizCategory(category)) return {};
  const meta = CATEGORY_META[category];
  return { title: meta.name, description: meta.tagline };
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isQuizCategory(category)) notFound();
  const meta = CATEGORY_META[category];

  return (
    <div>
      <header className="mb-7 text-center">
        <span
          className={`mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-2xl shadow-lg`}
          aria-hidden
        >
          {meta.emoji}
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{meta.name}</h1>
        <p className="mt-1.5 text-sm text-muted">{meta.tagline}</p>
      </header>
      <QuizController category={category} />
    </div>
  );
}
