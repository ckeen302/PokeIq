import type { Metadata } from "next";
import { QuizController } from "@/components/quiz/QuizController";
import { dayNumberOf, todayKey } from "@/lib/daily";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Daily Gauntlet",
  description:
    "10 seeded questions, identical for every trainer on Earth today.",
};

export default function DailyPage() {
  const dateKey = todayKey();
  const dayNumber = dayNumberOf(dateKey);
  const endsAt = new Date(
    Date.parse(`${dateKey}T00:00:00Z`) + 86_400_000,
  ).toISOString();

  return (
    <div>
      <header className="mb-7 text-center">
        <span
          className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 text-2xl shadow-lg"
          aria-hidden
        >
          🗓️
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-tight">
          Daily Gauntlet <span className="text-gradient">#{dayNumber}</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Same 10 seeded questions for every trainer · resets at midnight UTC
        </p>
      </header>
      <QuizController category="daily" dailyInfo={{ dayNumber, endsAt }} />
    </div>
  );
}
