import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CUSTOM_ID_RE } from "@/lib/connections/custom";
import { Connections } from "@/components/connections/Connections";
import { CommunityBar } from "@/components/connections/CommunityBar";
import { ConnNamesProvider } from "@/components/connections/names";
import { connTileNames } from "@/lib/connections/names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import conn from "@/messages/connections";
import board from "@/messages/connections-board";
import stats from "@/messages/connections-stats";
import community from "@/messages/connections-community";
import share from "@/messages/share";
import howto from "@/messages/howto";
import badges from "@/messages/badges";

// A trainer's puzzle: playable by its link, not for search engines.
export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return {
    title: t("meta.puzzleTitle"),
    description: t("meta.puzzleDescription"),
    robots: { index: false, follow: false },
  };
}

export default async function CommunityPuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CUSTOM_ID_RE.test(id)) notFound();
  // The tiles and every guess go through /api/connections (practice=custom-<id>); the groups never reach the page.
  // The creator's group names stay as written; the tiles show the Pokémon's names in the page's language.
  const t = serverT(pages);
  return (
    <div className="space-y-6">
      <BackButton href="/pokeconnections/community" label={t("backCommunity")} />
      <ClientMessages namespaces={[conn, board, stats, community, share, howto, badges]}>
        <ConnNamesProvider names={connTileNames(getLocale())}>
          <CommunityBar id={id} />
          <Connections customId={id} />
        </ConnNamesProvider>
      </ClientMessages>
    </div>
  );
}
