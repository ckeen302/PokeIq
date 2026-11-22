import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_PATH } from "@/lib/games/deeplink";
import { GamesHub } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesPages from "@/messages/games-pages";

export function generateMetadata(): Metadata {
  const t = serverT(gamesPages);
  return pageMetadata({
    title: t("meta.hubTitle"),
    description: t("meta.hubDescription"),
    path: GAMES_PATH,
    socialTitle: t("meta.hubSocial"),
    noindex: !GAMES_LIVE,
  });
}

export default function Page() {
  return <GamesHub />;
}
