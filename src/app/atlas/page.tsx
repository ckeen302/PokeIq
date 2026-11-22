import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { WorldAtlas } from "@/components/atlas/WorldAtlas";
import type { AtlasRegion } from "@/components/atlas/atlas-engine";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import atlasPage from "@/messages/atlas-page";
import atlasNs from "@/messages/atlas";
import { atlasNames } from "@/lib/dex/atlas-names";
import atlas from "../../../public/atlas/atlas.json";

// The region buttons are in the page itself, so the map below them doesn't jump down when the atlas loads.
const REGIONS = (atlas.regions as AtlasRegion[]).map(({ name, tier, x, y, chip, parent }) => ({ name, tier, x, y, ...(chip === false && { chip }), ...(parent && { parent }) }));

export function generateMetadata(): Metadata {
  const t = serverT(atlasPage);
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    image: SHARE_IMAGES.site,
    path: "/atlas",
  });
}

export default function AtlasPage() {
  // Another language's page sends the official names of the atlas's places and regions (English sends none).
  const names = atlasNames();
  return (
    <div className="space-y-4">
      <BackButton href="/" />
      <ClientMessages namespaces={[atlasNs]}>
        <WorldAtlas src="/geo/maps/world.webp" regions={REGIONS} {...(names && { names })} />
      </ClientMessages>
    </div>
  );
}
