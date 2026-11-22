import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { dleLabels, dleNames } from "@/lib/dle-lexicon";
import { PokedleWithCommunity } from "@/components/pokedle/PokedleCommunity";
import { PokedleDuelCard } from "@/components/pokedle/PokedleDuelCard";
import { GameInfo } from "@/components/seo/GameInfo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pokedle from "@/messages/pokedle";
import board from "@/messages/pokedle-board";
import game from "@/messages/pokedle-game";
import countdown from "@/messages/countdown";
import duelShared from "@/messages/duel";
import howto from "@/messages/howto";
import share from "@/messages/share";

export function generateMetadata(): Metadata {
  const t = serverT(pokedle);
  return pageMetadata({ title: t("meta.title"), description: t("meta.description"), path: "/pokedle" });
}

export default function PokedlePage() {
  const t = serverT(pokedle);
  const locale = getLocale();
  // Only id + name + gen go to the client (with the other names it answers to, in another language) — enough for autocomplete, no answers.
  const names = dleNames(locale);
  return (
    <div className="space-y-10">
      <ClientMessages namespaces={[board, game, duelShared, share, howto, countdown]}>
        <PokedleWithCommunity names={names} labels={dleLabels(locale)} />
        <div id="duel" className="scroll-mt-24 space-y-4">
          <PokedleDuelCard />
        </div>
      </ClientMessages>
      <GameInfo
        howToButton
        noFaq
        path="/pokedle"
        name={t("info.name")}
        description={t("info.description")}
        intro={t("info.intro")}
        steps={[t("info.step1"), t("info.step2"), t("info.step3"), t("info.step4")]}
        faqs={[
          { q: t("info.faqGuessesQ"), a: t("info.faqGuessesA") },
          { q: t("info.faqCluesQ"), a: t("info.faqCluesA") },
        ]}
      />
    </div>
  );
}
