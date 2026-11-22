import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { RACE_LIVE } from "@/lib/lab";
import { RacePage } from "@/components/race/RacePage";
import { serverT } from "@/i18n/server";
import racePages from "@/messages/race-pages";

export function generateMetadata(): Metadata {
  const t = serverT(racePages);
  return pageMetadata({
    title: t("meta.hubTitle"),
    description: t("meta.hubDescription"),
    path: "/pokedex/race",
    socialTitle: t("meta.hubSocial"),
    noindex: !RACE_LIVE,
  });
}

export default function Page() {
  return <RacePage />;
}
