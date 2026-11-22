import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { GlobeLoader } from "@/components/globe/GlobeLoader";
import { globeEras, globeRegionCards } from "@/lib/globe/regions";
import { serverT } from "@/i18n/server";
import pokeguessr from "@/messages/pokeguessr";

export function generateMetadata(): Metadata {
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("globe.title"),
    description: t("globe.description"),
    path: "/pokeguessr/globe",
    image: SHARE_IMAGES.guessr,
  });
}

export default function GlobePage() {
  const regions = globeRegionCards();
  return <GlobeLoader regions={regions} eras={globeEras(regions)} />;
}
