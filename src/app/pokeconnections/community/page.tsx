import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { CommunityList } from "@/components/connections/CommunityList";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import community from "@/messages/connections-community";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("meta.communityTitle"),
    description: t("meta.communityDescription"),
    path: "/pokeconnections/community",
    image: SHARE_IMAGES.site,
  });
}

export default function CommunityConnectionsPage() {
  const t = serverT(pages);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/pokeconnections" label={t("back")} />
      <ClientMessages namespaces={[community]}>
        <CommunityList />
      </ClientMessages>
    </div>
  );
}
