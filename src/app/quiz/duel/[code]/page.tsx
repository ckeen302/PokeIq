import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { QuizDuel } from "@/components/quiz/QuizDuel";
import { pvpStore } from "@/lib/server/duel-store";
import { MODULE_INFO, difficultyLabel } from "@/lib/modes";
import { pvpHref, QUIZ_DUEL_QUESTIONS } from "@/lib/pvp-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "quiz") return inviteMetadata("A Pokémon quiz duel", "Head-to-head Pokémon quiz: the same questions for both of you, right and fast scores most.");
  const mode = MODULE_INFO[duel.module].title;
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? `${host} vs ${guest}: a ${mode} duel` : `${host || "A trainer"} challenges you to a ${mode} duel`;
  const level = difficultyLabel(duel.module, duel.difficulty);
  const description = `Head-to-head ${mode}${level ? ` on ${level}` : ""}: the same ${QUIZ_DUEL_QUESTIONS} questions for both of you, right and fast scores most.`;
  return inviteMetadata(title, description);
}

export default async function QuizDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "quiz") redirect(pvpHref(duel.kind, code));
  return <QuizDuel key={code} code={code} />;
}
