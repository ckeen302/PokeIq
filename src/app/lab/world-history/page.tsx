import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { WORLD_HISTORY_LIVE } from "@/lib/lab";
import { HISTORY_PATH } from "@/lib/world-history/deeplink";
import { WorldHistoryPage } from "@/components/world-history/WorldHistoryPage";
import { serverT } from "@/i18n/server";
import historyNs from "@/messages/world-history";

export function generateMetadata(): Metadata {
  const t = serverT(historyNs);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: HISTORY_PATH,
    socialTitle: t("meta.socialTitle"),
    noindex: !WORLD_HISTORY_LIVE,
  });
}

export default function Page() {
  return <WorldHistoryPage />;
}
