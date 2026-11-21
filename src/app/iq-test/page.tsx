import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { IqTest } from "@/components/iq-test/IqTest";
import { cognitiveLocal } from "@/lib/cognitive/local";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import iq from "@/messages/iq-test";
import play from "@/messages/iq-test-play";
import results from "@/messages/iq-test-results";
import share from "@/messages/share";

export function generateMetadata(): Metadata {
  const t = serverT(iq);
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/iq-test",
  });
}

export default function IqTestPage() {
  const t = serverT(iq);
  return (
    <>
      <GameJsonLd name={t("name")} path="/iq-test" description={t("description")} />
      <ClientMessages namespaces={[play, results, share]}>
        <IqTest local={cognitiveLocal(getLocale())} />
      </ClientMessages>
    </>
  );
}
