import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import pageNs from "@/messages/timeline-page";
import { TimelinePage } from "@/components/timeline/TimelinePage";

export function generateMetadata(): Metadata {
  const t = serverT(pageNs);
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/pokedex/timeline",
  });
}

export default function Page() {
  return <TimelinePage />;
}
