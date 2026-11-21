import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { CompareView } from "@/components/which-pokemon/CompareView";
import { WpLocalProvider } from "@/components/which-pokemon/parts";
import { pageMetadata } from "@/lib/seo";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";
import { wpLocal } from "@/lib/which-pokemon/i18n";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import wp from "@/messages/which-pokemon";
import resultNs from "@/messages/which-pokemon-result";
import share from "@/messages/share";

/**
 * /quiz/which-pokemon/compare: two results side by side with a
 * compatibility score. Both results travel in the fragment, so the page is
 * static, personal, and needs no account; it is kept out of search.
 */

export function generateMetadata(): Metadata {
  const t = serverT(wp);
  return pageMetadata({
    title: t("compare.title"),
    description: t("compare.description"),
    socialTitle: t("compare.socialTitle"),
    image: { url: "/quiz/which-pokemon/opengraph-image", alt: t("compare.imageAlt") },
    noindex: true,
  });
}

export default function ComparePage() {
  const t = serverT(wp);
  return (
    <div className="space-y-8">
      <BackButton href={QUIZ_PATH} label={t("result.back")} />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label text-screen">{t("compare.kicker")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("compare.title2")}</h1>
      </header>
      <ClientMessages namespaces={[resultNs, share]}>
        <WpLocalProvider local={wpLocal(getLocale())}>
          <CompareView />
        </WpLocalProvider>
      </ClientMessages>
    </div>
  );
}
