import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { QuizDuel } from "@/components/quiz/QuizDuel";
import { pvpStore } from "@/lib/server/duel-store";
import { MODULE_INFO } from "@/lib/modes";
import { pvpHref, QUIZ_DUEL_QUESTIONS } from "@/lib/pvp-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "quiz") return { title: "Quiz duel", robots: { index: false } };
  const mode = MODULE_INFO[duel.module].title;
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? `${host} vs ${guest}: a ${mode} duel` : `${host || "A trainer"} challenges you to a ${mode} duel`;
  const description = `Head-to-head ${mode} on ${duel.difficulty}: the same ${QUIZ_DUEL_QUESTIONS} questions for both of you, right and fast scores most.`;
  return {
    title,
    description,
    openGraph: { title, description: `The same ${QUIZ_DUEL_QUESTIONS} questions, 15 seconds each. The most points wins.` },
    robots: { index: false },
  };
}

export default async function QuizDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "quiz") redirect(pvpHref(duel.kind, code));
  return <QuizDuel key={code} code={code} />;
}
