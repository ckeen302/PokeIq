import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { LabPage } from "@/components/lab/LabPage";
import { serverT } from "@/i18n/server";
import lab from "@/messages/lab";

export function generateMetadata(): Metadata {
  const t = serverT(lab);
  return pageMetadata({
    title: t("meta.title"),
    description: t(POKEMON_STORY_LIVE ? "meta.descriptionStory" : "meta.descriptionTimeline"),
    path: "/lab",
    socialTitle: t("meta.socialTitle"),
  });
}

export default function Page() {
  return <LabPage />;
}
