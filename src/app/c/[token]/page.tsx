import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { readShareCard } from "@/lib/server/share-card";
import { dailyNumber } from "@/lib/daily";
import { ChallengeLanding } from "@/components/challenge/ChallengeLanding";
import { DexNamesProvider } from "@/components/quiz/zoom/use-dex-names";
import { zoomNames } from "@/lib/quiz-names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/quiz-pages";
import modes from "@/messages/quiz-modes";
import challenge from "@/messages/quiz-challenge";
import run from "@/messages/quiz-run";
import badges from "@/messages/badges";
import board from "@/messages/pokedle-board";
import copyFallback from "@/messages/copy-fallback";
import common from "@/messages/common";
import share from "@/messages/share";
import countdown from "@/messages/countdown";

/**
 * /c/<signed share token> — every shared result is a challenge. The token
 * is server-signed (no forged scores) and carries the run's seed, so the
 * friend replays the exact same questions.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

function describeRun(card: NonNullable<ReturnType<typeof readShareCard>>) {
  const t = serverT(pages);
  const mt = serverT(modes);
  return card.day ? t("challenge.daily", { n: dailyNumber(card.day) }) : t("challenge.run", { mode: mt(`modules.${card.m}.title`), format: mt(`formats.${card.f}.title`) });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const card = readShareCard((await params).token);
  const t = serverT(pages);
  if (!card) return { title: t("challenge.title") };
  const who = card.n || t("challenge.aTrainer");
  const title = t("challenge.scored", { who, correct: card.c, total: card.t, iq: card.q });
  // The preview's every field (site name, description, the link itself) from the one helper; its picture is this
  // segment's opengraph-image.
  return pageMetadata({ title, description: t("challenge.description", { run: describeRun(card) }), socialTitle: title, noindex: true, url: `/c/${encodeURIComponent((await params).token)}` });
}

export default async function ChallengePage({ params }: PageProps) {
  const { token } = await params;
  const card = readShareCard(token);
  if (!card) notFound();
  const locale = getLocale();
  const landing = <ChallengeLanding card={card} token={decodeURIComponent(token)} runLabel={describeRun(card)} />;
  return (
    <ClientMessages namespaces={[challenge, modes, run, badges, board, copyFallback, common, share, countdown]}>
      {/* A Zoom Reveal challenge's guess box gets its names in the page's language from here (English pages fetch them). */}
      {card.m === "zoom-reveal" && locale !== "en" ? <DexNamesProvider names={zoomNames(locale)}>{landing}</DexNamesProvider> : landing}
    </ClientMessages>
  );
}
