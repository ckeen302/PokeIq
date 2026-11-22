import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Swords } from "lucide-react";
import { ModeGrid } from "@/components/home/ModeGrid";
import { QuizDuelCard } from "@/components/quiz/QuizDuelCard";
import { QuizFeatured } from "@/components/quiz/QuizFeatured";
import { GameInfo } from "@/components/seo/GameInfo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pages from "@/messages/quiz-pages";
import modes from "@/messages/quiz-modes";
import setup from "@/messages/quiz-setup";
import duelShared from "@/messages/duel";
import featured from "@/messages/quiz-featured";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({ title: t("hub.title"), description: t("hub.description"), path: "/quiz" });
}

export default function PlayPage() {
  const t = serverT(pages);
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("hub.h1")}</h1>
      </div>
      <ClientMessages namespaces={[featured]}>
        <QuizFeatured />
      </ClientMessages>
      <ClientMessages namespaces={[modes, setup, duelShared]}>
        <ModeGrid />
      </ClientMessages>
      <section className="space-y-3" aria-labelledby="duels">
        <h2 id="duels" className="flex items-center gap-2 text-xl font-bold">
          <Swords className="h-5 w-5 text-primary" aria-hidden /> {t("hub.duel")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("hub.duelLine")}</p>
        <ClientMessages namespaces={[modes, setup, duelShared]}>
          <QuizDuelCard />
        </ClientMessages>
      </section>
      <GameInfo
        hidden
        path="/quiz"
        name={t("hub.infoName")}
        description={t("hub.infoDescription")}
        intro={t("hub.infoIntro")}
        steps={[t("hub.step1"), t("hub.step2"), t("hub.step3"), t("hub.step4")]}
        faqs={[
          { q: t("hub.faqFormatsQ"), a: t("hub.faqFormatsA") },
          { q: t("hub.faqGensQ"), a: t("hub.faqGensA") },
        ]}
      />
    </div>
  );
}
