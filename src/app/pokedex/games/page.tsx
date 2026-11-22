import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { GamesExplorer } from "@/components/pokedex/games/GamesExplorer";
import { VIDEO_GAMES, toCard, type VideoGame } from "@/lib/dex/video-games";
import { gameTexts, localizeGame } from "@/lib/dex/video-games-i18n";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import dexGames from "@/messages/dex-games";
import dexGamesList from "@/messages/dex-games-list";

export function generateMetadata(): Metadata {
  const t = serverT(dexGames);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/pokedex/games",
    socialTitle: t("meta.socialTitle"),
  });
}

export default function GamesPage() {
  const locale = getLocale();
  return locale === DEFAULT_LOCALE ? <GamesView games={VIDEO_GAMES} /> : <LocalGamesView locale={locale} />;
}

/** Another language's list: the games with their titles in that language. */
async function LocalGamesView({ locale }: { locale: Locale }) {
  const tx = await gameTexts(locale);
  return <GamesView games={VIDEO_GAMES.map((g) => localizeGame(g, tx))} />;
}

function GamesView({ games }: { games: VideoGame[] }) {
  const t = serverT(dexGames);
  const link = (href: string) =>
    function CreditLink(chunks: React.ReactNode) {
      return (
        <a href={href} className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          {chunks}
        </a>
      );
    };
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <ListHeader kicker={t("header.kicker")} title={t("header.title")} accent={t("header.accent")} blurb={t("header.blurb")} />
      <DexTabs active="games" />
      <ClientMessages namespaces={[dexGamesList]}>
        <GamesExplorer games={games.map(toCard)} />
      </ClientMessages>
      <p className="pt-6 text-center text-xs text-muted-foreground">
        {t.rich("credit", {
          wiki: link("https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon_video_games"),
          serebii: link("https://www.serebii.net/"),
        })}
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            breadcrumbList([
              { name: t("ld.pokedex"), path: "/pokedex" },
              { name: t("ld.games"), path: "/pokedex/games" },
            ]),
            itemList(
              t("ld.list"),
              games.map((g) => ({ name: g.name, path: `/pokedex/games/${g.slug}` }))
            ),
          ]),
        }}
      />
    </div>
  );
}
