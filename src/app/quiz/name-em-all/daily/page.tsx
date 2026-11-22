import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { NeaDaily } from "@/components/name-em-all/NeaDaily";
import { pageMetadata } from "@/lib/seo";
import { NEA_PATH } from "@/lib/name-em-all/categories";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import neaPages from "@/messages/nea-pages";
import neaDaily from "@/messages/nea-daily";
import neaGame from "@/messages/nea-game";

export function generateMetadata(): Metadata {
  const t = serverT(neaPages);
  return pageMetadata({
    title: t("daily.metaTitle"),
    description: t("daily.metaDescription"),
    path: `${NEA_PATH}/daily`,
    image: { url: `${NEA_PATH}/opengraph-image`, alt: t("ogAlt") },
  });
}

export default function NameEmAllDailyPage() {
  const t = serverT(neaPages);
  return (
    <div className="space-y-6">
      <BackButton href={NEA_PATH} label={t("back")} />
      <ClientMessages namespaces={[neaDaily, neaGame]}>
        <NeaDaily />
      </ClientMessages>
    </div>
  );
}
