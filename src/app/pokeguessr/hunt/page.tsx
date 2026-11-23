import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { HuntGame } from "@/components/hunt/HuntGame";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";
import { HUNT_MAP_REGIONS } from "@/lib/hunt/types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import hunt from "@/messages/hunt";
import { GEO_HUNT_NAMESPACES } from "@/lib/geo-namespaces";

export function generateMetadata(): Metadata {
  const t = serverT(hunt);
  return pageMetadata({
    title: t("name"),
    description: t("hub.tagline"),
    path: "/pokeguessr/hunt",
    image: SHARE_IMAGES.guessr,
  });
}

/** Pokémon Hunt: see a Pokémon, pin where it lives. The world map and the nine region maps it can be played on. */
export default function HuntPage() {
  const ids = new Set<string>([WORLD_REGION, ...HUNT_MAP_REGIONS]);
  const maps = geoRegions().filter((r) => ids.has(r.id));
  return (
    <ClientMessages namespaces={GEO_HUNT_NAMESPACES}>
      <HuntGame maps={maps} />
    </ClientMessages>
  );
}
