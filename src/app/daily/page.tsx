import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { DailyChallenge } from "@/components/daily/DailyChallenge";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pages from "@/messages/quiz-pages";
import daily from "@/messages/quiz-daily";
import modes from "@/messages/quiz-modes";
import run from "@/messages/quiz-run";
import badges from "@/messages/badges";
import copyFallback from "@/messages/copy-fallback";
import share from "@/messages/share";
import countdown from "@/messages/countdown";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("daily.title"),
    description: t("daily.description"),
    path: "/daily",
  });
}

export default function DailyPage() {
  const t = serverT(pages);
  return (
    <>
      <GameJsonLd name={t("daily.title")} path="/daily" description={t("daily.description")} />
      <ClientMessages namespaces={[daily, modes, run, badges, copyFallback, share, countdown]}>
        <DailyChallenge />
      </ClientMessages>
    </>
  );
}
