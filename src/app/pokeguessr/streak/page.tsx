import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { StreakGame } from "@/components/geo/StreakGame";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pokeguessr from "@/messages/pokeguessr";
import { GEO_STREAK_NAMESPACES } from "@/lib/geo-namespaces";

export function generateMetadata(): Metadata {
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("streak.title"),
    description: t("streak.description"),
    path: "/pokeguessr/streak",
    image: SHARE_IMAGES.guessr,
  });
}

export default function StreakPage() {
  const world = geoRegions().find((r) => r.id === WORLD_REGION);
  if (!world) notFound();
  return (
    <ClientMessages namespaces={GEO_STREAK_NAMESPACES}>
      <StreakGame world={world} />
    </ClientMessages>
  );
}
