import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { DuelHistoryList } from "@/components/geo/DuelHistory";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pokeguessr from "@/messages/pokeguessr";
import geoNamesNs from "@/messages/geo-names";
import { localMap } from "@/lib/geo-i18n";
import { GEO_REPLAY_NAMESPACES } from "@/lib/geo-namespaces";

export function generateMetadata(): Metadata {
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("history.title"),
    description: t("history.description"),
    path: "/pokeguessr/history",
    image: SHARE_IMAGES.guessr,
    noindex: true,
  });
}

/** Map ids to the names the list shows, in the page's language. */
function mapNames(worldMap: string) {
  const names = serverT(geoNamesNs);
  return Object.fromEntries(geoRegions().map((r) => [r.id, r.id === WORLD_REGION ? worldMap : localMap(names, r)]));
}

export default function DuelHistoryPage() {
  const t = serverT(pokeguessr);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton href="/pokeguessr" label={t("history.back")} />
      <header className="space-y-1">
        <p className="hud-label text-screen">PokéGuessr</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("history.h1")}</h1>
        <p className="text-sm text-muted-foreground">{t("history.intro")}</p>
      </header>
      {/* Hold about the empty-history card's height while the list loads, so the page doesn't jump when it appears. */}
      <div className="min-h-[12.25rem] sm:min-h-44">
        <ClientMessages namespaces={GEO_REPLAY_NAMESPACES}>
          <DuelHistoryList mapNames={mapNames(t("history.worldMap"))} />
        </ClientMessages>
      </div>
    </div>
  );
}
