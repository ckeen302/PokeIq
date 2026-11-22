import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getLocale, redirect, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { QuizDuel } from "@/components/quiz/QuizDuel";
import { DexNamesProvider } from "@/components/quiz/zoom/use-dex-names";
import { zoomNames } from "@/lib/quiz-names";
import { pvpStore } from "@/lib/server/duel-store";
import { levelKey } from "@/lib/modes";
import { pvpHref, QUIZ_DUEL_QUESTIONS } from "@/lib/pvp-types";
import pages from "@/messages/quiz-pages";
import modes from "@/messages/quiz-modes";
import duelNs from "@/messages/quiz-duel";
import run from "@/messages/quiz-run";
import board from "@/messages/pokedle-board";
import copyFallback from "@/messages/copy-fallback";
import duelShared from "@/messages/duel";
import share from "@/messages/share";
import tier from "@/messages/tier";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  const t = serverT(pages);
  if (!duel || duel.kind !== "quiz") return inviteMetadata(t("duel.title"), t("duel.description"));
  const mt = serverT(modes);
  const mode = mt(`modules.${duel.module}.title`);
  // Trainer names are theirs: never translated.
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? t("duel.versus", { host, guest, mode }) : t("duel.challenge", { host: host || t("duel.aTrainer"), mode });
  const key = levelKey(duel.module, duel.difficulty);
  const description = key ? t("duel.inviteLevel", { mode, level: mt(`levels.${key}.label`), n: QUIZ_DUEL_QUESTIONS }) : t("duel.invite", { mode, n: QUIZ_DUEL_QUESTIONS });
  return inviteMetadata(title, description);
}

export default async function QuizDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "quiz") redirect(pvpHref(duel.kind, code));
  const locale = getLocale();
  const game = <QuizDuel key={code} code={code} />;
  // A Zoom Reveal duel's guess box gets its names in the page's language from here (English pages fetch them).
  const zoom = locale !== "en" && duel?.kind === "quiz" && duel.module === "zoom-reveal";
  return (
    <ClientMessages namespaces={[duelNs, run, modes, board, copyFallback, duelShared, share, tier]}>
      {zoom ? <DexNamesProvider names={zoomNames(locale)}>{game}</DexNamesProvider> : game}
    </ClientMessages>
  );
}
