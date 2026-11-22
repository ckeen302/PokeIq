import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { CreatePuzzle } from "@/components/connections/CreatePuzzle";
import { ConnNamesProvider } from "@/components/connections/names";
import { connSearchNames, connTileNames } from "@/lib/connections/names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import create from "@/messages/connections-create";
import board from "@/messages/connections-board";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("meta.createTitle"),
    description: t("meta.createDescription"),
    path: "/pokeconnections/create",
    image: SHARE_IMAGES.site,
  });
}

export default function CreateConnectionsPage() {
  const t = serverT(pages);
  const locale = getLocale();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/pokeconnections/community" label={t("backCommunity")} />
      <ClientMessages namespaces={[create, board]}>
        <ConnNamesProvider names={connTileNames(locale)}>
          <CreatePuzzle {...(locale !== "en" && { names: connSearchNames(locale) })} />
        </ConnNamesProvider>
      </ClientMessages>
    </div>
  );
}
